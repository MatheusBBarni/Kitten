import {
  DuplicateJournalEventError,
  ProjectionVersionConflictError,
  type EventJournal,
  type JournalActor,
  type JournalEvent,
  type ProjectionChange,
  type ProjectionVersionPrecondition,
  type WorkflowCommandEventPayload,
} from "../persistence/eventJournal.ts";
import { isCardStageLocked } from "../board/cardTransitionCoordinator.ts";
import {
  type BoardProjection,
  type CardProjection,
  type EdgeProjection,
  type StageProjection,
  type WorkflowCommand,
  type WorkflowCommandResult,
  type WorkflowConflict,
  type WorkflowRejectionKind,
} from "./workflowTypes.ts";
import {
  immediateSuccessor,
  sortStagesByPosition,
  validateLinearWorkflow,
} from "./workflowValidation.ts";

export interface WorkflowCommandHandler {
  execute(command: WorkflowCommand): WorkflowCommandResult;
}

export interface WorkflowCommandHandlerOptions {
  readonly now?: () => number;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(",")}}`;
}

function eventIdFor(command: WorkflowCommand): string {
  return `workflow:${command.mutationId}`;
}

function reject(
  command: WorkflowCommand,
  kind: WorkflowRejectionKind,
  message: string,
): WorkflowCommandResult {
  return { status: "rejected", mutationId: command.mutationId, rejection: { kind, message } };
}

function conflict(command: WorkflowCommand, value: WorkflowConflict): WorkflowCommandResult {
  return { status: "conflict", mutationId: command.mutationId, conflict: value };
}

function workflowConflict(
  command: WorkflowCommand,
  board: BoardProjection | undefined,
  expectedVersion: number,
): WorkflowCommandResult | null {
  const actualVersion = board?.workflowVersion ?? 0;
  return actualVersion === expectedVersion
    ? null
    : conflict(command, {
        kind: "stale_workflow",
        boardId: command.boardId,
        expectedVersion,
        actualVersion,
      });
}

function cardConflict(
  command: Extract<WorkflowCommand, { cardId: unknown }>,
  card: CardProjection | undefined,
  expectedVersion: number,
): WorkflowCommandResult | null {
  const actualVersion = card?.version ?? 0;
  return actualVersion === expectedVersion
    ? null
    : conflict(command, {
        kind: "stale_card",
        cardId: command.cardId,
        expectedVersion,
        actualVersion,
      });
}

function priorMutationResult(
  journal: EventJournal,
  command: WorkflowCommand,
): WorkflowCommandResult | null {
  const eventId = eventIdFor(command);
  const prior = journal.eventById(eventId);
  if (prior === null) return null;
  const fingerprint = stableSerialize(command);
  if (
    prior.kind === "workflow_command_committed" &&
    prior.payload.mutationId === command.mutationId &&
    prior.payload.commandKind === command.kind &&
    prior.payload.commandFingerprint === fingerprint
  ) {
    return { status: "idempotent", mutationId: command.mutationId, eventId };
  }
  return reject(
    command,
    "mutation_identity_conflict",
    `Mutation identity ${command.mutationId} was already used for a different command`,
  );
}

function workflowState(
  journal: EventJournal,
  boardId: BoardProjection["boardId"],
): {
  readonly board: BoardProjection | undefined;
  readonly stages: readonly StageProjection[];
  readonly edges: readonly EdgeProjection[];
} {
  const snapshot = journal.snapshot();
  return {
    board: snapshot.boards.find((board) => board.boardId === boardId),
    stages: sortStagesByPosition(snapshot.stages.filter((stage) => stage.boardId === boardId)),
    edges: snapshot.edges.filter((edge) => edge.boardId === boardId),
  };
}

function workflowProjectionChanges(
  board: BoardProjection,
  currentEdges: readonly EdgeProjection[],
  stages: readonly StageProjection[],
  edges: readonly EdgeProjection[],
  occurredAt: number,
): readonly ProjectionChange[] {
  const workflowVersion = board.workflowVersion + 1;
  const nextBoard: BoardProjection = { ...board, workflowVersion, updatedAt: occurredAt };
  const nextStages = stages.map((stage) => ({
    ...stage,
    workflowVersion,
    updatedAt: occurredAt,
  }));
  const nextEdges = edges.map((edge) => ({ ...edge, workflowVersion }));
  return [
    { entity: "board", operation: "upsert", value: nextBoard },
    ...nextStages.map((value): ProjectionChange => ({ entity: "stage", operation: "upsert", value })),
    ...currentEdges.map((value): ProjectionChange => ({ entity: "edge", operation: "delete", value })),
    ...nextEdges.map((value): ProjectionChange => ({ entity: "edge", operation: "upsert", value })),
  ];
}

function commandEvent(
  command: WorkflowCommand,
  actor: JournalActor,
  occurredAt: number,
  changes: readonly ProjectionChange[],
): JournalEvent {
  const payload: WorkflowCommandEventPayload = {
    mutationId: command.mutationId,
    commandKind: command.kind,
    commandFingerprint: stableSerialize(command),
    changes,
  };
  return {
    eventId: eventIdFor(command),
    boardId: command.boardId,
    ...(changes.length === 1 && changes[0]?.entity === "card"
      ? { cardId: changes[0].value.cardId }
      : {}),
    actor,
    kind: "workflow_command_committed",
    occurredAt,
    payload,
  };
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function ensureCardFields(
  command: Extract<WorkflowCommand, { kind: "create_card" | "update_card" }>,
): WorkflowCommandResult | null {
  if (
    !isNonEmpty(command.title) ||
    !isNonEmpty(command.provider) ||
    !isNonEmpty(command.model) ||
    !isNonEmpty(command.effort)
  ) {
    return reject(command, "invalid_card", "Card title, provider, model, and effort must not be empty");
  }
  return null;
}

function exactStageOrder(
  stages: readonly StageProjection[],
  orderedStageIds: readonly StageProjection["stageId"][],
): boolean {
  if (orderedStageIds.length !== stages.length || new Set(orderedStageIds).size !== stages.length) {
    return false;
  }
  const expected = new Set(stages.map((stage) => stage.stageId));
  return orderedStageIds.every((stageId) => expected.has(stageId));
}

function fromVersionError(command: WorkflowCommand, error: ProjectionVersionConflictError): WorkflowCommandResult {
  return error.entity === "board"
    ? conflict(command, {
        kind: "stale_workflow",
        boardId: error.id as BoardProjection["boardId"],
        expectedVersion: error.expectedVersion,
        actualVersion: error.actualVersion,
      })
    : conflict(command, {
        kind: "stale_card",
        cardId: error.id as CardProjection["cardId"],
        expectedVersion: error.expectedVersion,
        actualVersion: error.actualVersion,
      });
}

export function createWorkflowCommandHandler(
  journal: EventJournal,
  options: WorkflowCommandHandlerOptions = {},
): WorkflowCommandHandler {
  const now = options.now ?? Date.now;

  return {
    execute(command) {
      const prior = priorMutationResult(journal, command);
      if (prior !== null) return prior;

      const occurredAt = now();
      const state = workflowState(journal, command.boardId);
      let actor: JournalActor = "operator";
      let changes: readonly ProjectionChange[];
      const preconditions: ProjectionVersionPrecondition[] = [];

      switch (command.kind) {
        case "bind_repository": {
          const stale = workflowConflict(command, state.board, 0);
          if (stale !== null) return stale;
          if (!isNonEmpty(command.repositoryPath)) {
            return reject(command, "invalid_repository", "Trusted repository path must not be empty");
          }
          changes = [{
            entity: "board",
            operation: "upsert",
            value: {
              boardId: command.boardId,
              repositoryPath: command.repositoryPath,
              workflowVersion: 1,
              createdAt: occurredAt,
              updatedAt: occurredAt,
            },
          }];
          preconditions.push({ entity: "board", id: command.boardId, expectedVersion: 0 });
          break;
        }
        case "create_stage": {
          const stale = workflowConflict(command, state.board, command.expectedWorkflowVersion);
          if (stale !== null) return stale;
          if (state.board === undefined) return reject(command, "board_not_found", "Board does not exist");
          if (!isNonEmpty(command.label)) return reject(command, "invalid_label", "Stage label must not be empty");
          if (journal.snapshot().stages.some((stage) => stage.stageId === command.stageId)) {
            return reject(command, "duplicate_stage", `Stage ${command.stageId} already exists`);
          }
          const stage: StageProjection = {
            stageId: command.stageId,
            boardId: command.boardId,
            label: command.label,
            position: state.stages.length,
            defaultSkillId: null,
            configured: false,
            workflowVersion: state.board.workflowVersion + 1,
            updatedAt: occurredAt,
          };
          changes = workflowProjectionChanges(
            state.board,
            state.edges,
            [...state.stages, stage],
            state.edges,
            occurredAt,
          );
          preconditions.push({
            entity: "board", id: command.boardId, expectedVersion: command.expectedWorkflowVersion,
          });
          break;
        }
        case "update_stage":
        case "assign_stage_skill": {
          const stale = workflowConflict(command, state.board, command.expectedWorkflowVersion);
          if (stale !== null) return stale;
          if (state.board === undefined) return reject(command, "board_not_found", "Board does not exist");
          const stage = state.stages.find((candidate) => candidate.stageId === command.stageId);
          if (stage === undefined) return reject(command, "stage_not_found", "Stage does not exist on this board");
          if (command.kind === "update_stage" && !isNonEmpty(command.label)) {
            return reject(command, "invalid_label", "Stage label must not be empty");
          }
          const stages = state.stages.map((candidate): StageProjection => candidate.stageId !== command.stageId
            ? candidate
            : command.kind === "update_stage"
              ? { ...candidate, label: command.label }
              : {
                  ...candidate,
                  defaultSkillId: command.defaultSkillId,
                  configured: command.defaultSkillId !== null,
                });
          changes = workflowProjectionChanges(state.board, state.edges, stages, state.edges, occurredAt);
          preconditions.push({
            entity: "board", id: command.boardId, expectedVersion: command.expectedWorkflowVersion,
          });
          break;
        }
        case "connect_stages": {
          const stale = workflowConflict(command, state.board, command.expectedWorkflowVersion);
          if (stale !== null) return stale;
          if (state.board === undefined) return reject(command, "board_not_found", "Board does not exist");
          const edges: EdgeProjection[] = command.edges.map((edge) => ({
            boardId: command.boardId,
            sourceStageId: edge.sourceStageId,
            targetStageId: edge.targetStageId,
            workflowVersion: state.board!.workflowVersion + 1,
          }));
          const validation = validateLinearWorkflow(state.stages, edges);
          if (!validation.valid) {
            return reject(command, "invalid_workflow", validation.error.message);
          }
          changes = workflowProjectionChanges(state.board, state.edges, state.stages, edges, occurredAt);
          preconditions.push({
            entity: "board", id: command.boardId, expectedVersion: command.expectedWorkflowVersion,
          });
          break;
        }
        case "reorder_stages": {
          const stale = workflowConflict(command, state.board, command.expectedWorkflowVersion);
          if (stale !== null) return stale;
          if (state.board === undefined) return reject(command, "board_not_found", "Board does not exist");
          if (!exactStageOrder(state.stages, command.orderedStageIds)) {
            return reject(command, "invalid_stage_order", "Stage order must contain every board stage exactly once");
          }
          const byId = new Map(state.stages.map((stage) => [stage.stageId, stage]));
          const stages = command.orderedStageIds.map((stageId, position): StageProjection => ({
            ...byId.get(stageId)!,
            position,
          }));
          const edges = command.orderedStageIds.slice(0, -1).map((sourceStageId, index): EdgeProjection => ({
            boardId: command.boardId,
            sourceStageId,
            targetStageId: command.orderedStageIds[index + 1]!,
            workflowVersion: state.board!.workflowVersion + 1,
          }));
          changes = workflowProjectionChanges(state.board, state.edges, stages, edges, occurredAt);
          preconditions.push({
            entity: "board", id: command.boardId, expectedVersion: command.expectedWorkflowVersion,
          });
          break;
        }
        case "create_card": {
          const stale = workflowConflict(command, state.board, command.expectedWorkflowVersion);
          if (stale !== null) return stale;
          if (state.board === undefined) return reject(command, "board_not_found", "Board does not exist");
          const fieldsError = ensureCardFields(command);
          if (fieldsError !== null) return fieldsError;
          if (!state.stages.some((stage) => stage.stageId === command.stageId)) {
            return reject(command, "stage_not_found", "Card stage does not exist on this board");
          }
          if (journal.snapshot().cards.some((card) => card.cardId === command.cardId)) {
            return reject(command, "duplicate_card", `Card ${command.cardId} already exists`);
          }
          changes = [{
            entity: "card",
            operation: "upsert",
            value: {
              cardId: command.cardId,
              boardId: command.boardId,
              stageId: command.stageId,
              title: command.title,
              description: command.description,
              provider: command.provider,
              model: command.model,
              effort: command.effort,
              skillOverrideId: command.skillOverrideId,
              runnable: command.runnable,
              executionStatus: "idle",
              version: 1,
              createdAt: occurredAt,
              updatedAt: occurredAt,
            },
          }];
          preconditions.push(
            { entity: "board", id: command.boardId, expectedVersion: command.expectedWorkflowVersion },
            { entity: "card", id: command.cardId, expectedVersion: 0 },
          );
          break;
        }
        case "update_card":
        case "set_card_execution_status": {
          const snapshot = journal.snapshot();
          const card = snapshot.cards.find((candidate) => candidate.cardId === command.cardId);
          const stale = cardConflict(command, card, command.expectedCardVersion);
          if (stale !== null) return stale;
          if (card === undefined || card.boardId !== command.boardId) {
            return reject(command, "card_not_found", "Card does not exist on this board");
          }
          if (command.kind === "update_card") {
            const fieldsError = ensureCardFields(command);
            if (fieldsError !== null) return fieldsError;
          } else {
            actor = "system";
          }
          const value: CardProjection = command.kind === "update_card"
            ? {
                ...card,
                title: command.title,
                description: command.description,
                provider: command.provider,
                model: command.model,
                effort: command.effort,
                skillOverrideId: command.skillOverrideId,
                runnable: command.runnable,
                version: card.version + 1,
                updatedAt: occurredAt,
              }
            : {
                ...card,
                executionStatus: command.executionStatus,
                version: card.version + 1,
                updatedAt: occurredAt,
              };
          changes = [{ entity: "card", operation: "upsert", value }];
          preconditions.push({ entity: "card", id: command.cardId, expectedVersion: command.expectedCardVersion });
          break;
        }
        case "move_card":
        case "record_agent_success": {
          const workflowStale = workflowConflict(command, state.board, command.expectedWorkflowVersion);
          if (workflowStale !== null) return workflowStale;
          if (state.board === undefined) return reject(command, "board_not_found", "Board does not exist");
          const card = journal.snapshot().cards.find((candidate) => candidate.cardId === command.cardId);
          const stale = cardConflict(command, card, command.expectedCardVersion);
          if (stale !== null) return stale;
          if (card === undefined || card.boardId !== command.boardId) {
            return reject(command, "card_not_found", "Card does not exist on this board");
          }
          const validation = validateLinearWorkflow(state.stages, state.edges);
          if (!validation.valid) return reject(command, "invalid_workflow", validation.error.message);
          const successor = immediateSuccessor(card.stageId, state.edges);
          let value: CardProjection;
          if (command.kind === "move_card") {
            if (isCardStageLocked(card)) {
              return reject(command, "stage_locked", `Card ${card.cardId} is stage-locked while ${card.executionStatus}`);
            }
            if (successor !== command.targetStageId) {
              return reject(command, "not_immediate_successor", "Human moves may target only the immediate successor");
            }
            value = { ...card, stageId: command.targetStageId, version: card.version + 1, updatedAt: occurredAt };
          } else {
            actor = "agent";
            if (card.executionStatus === "needs_attention") {
              return reject(command, "stage_locked", `Card ${card.cardId} is stage-locked while needs_attention`);
            }
            if (card.executionStatus !== "running") {
              return reject(command, "invalid_execution_status", "Agent success requires a running card");
            }
            value = successor === null
              ? {
                  ...card,
                  executionStatus: "ready_for_review",
                  version: card.version + 1,
                  updatedAt: occurredAt,
                }
              : {
                  ...card,
                  stageId: successor,
                  executionStatus: "idle",
                  version: card.version + 1,
                  updatedAt: occurredAt,
                };
          }
          changes = [{ entity: "card", operation: "upsert", value }];
          preconditions.push(
            { entity: "board", id: command.boardId, expectedVersion: command.expectedWorkflowVersion },
            { entity: "card", id: command.cardId, expectedVersion: command.expectedCardVersion },
          );
          break;
        }
      }

      const event = commandEvent(command, actor, occurredAt, changes);
      try {
        return {
          status: "committed",
          mutationId: command.mutationId,
          delta: journal.append(event, { preconditions }),
        };
      } catch (error) {
        if (error instanceof ProjectionVersionConflictError) return fromVersionError(command, error);
        if (error instanceof DuplicateJournalEventError) {
          return priorMutationResult(journal, command) ?? reject(
            command,
            "mutation_identity_conflict",
            `Mutation identity ${command.mutationId} could not be applied safely`,
          );
        }
        throw error;
      }
    },
  };
}
