import type { DesktopRpcClient } from "../../client.ts";
import type {
  WorkflowBoardProjection,
  WorkflowCatalogProjection,
  WorkflowCommandRpcResult,
} from "../../../shared/rpc.ts";
import type { SkillCatalogEntry } from "../../../catalog/contracts.ts";
import {
  workflowIds,
  type CardProjection,
  type SkillId,
  type StageId,
  type StageProjection,
  type WorkflowCommand,
} from "../../../workflow/workflowTypes.ts";
import { deriveImmediateSuccessorArrows, type StageReorderIntent } from "./workflowCanvas.ts";

export const STARTER_STAGE_LABELS = [
  "Backlog",
  "To-do",
  "Refinement",
  "Ready",
  "Doing",
  "Finished",
  "Closed",
] as const;

export type BoardInteractionResult =
  | WorkflowCommandRpcResult
  | { readonly status: "invalid"; readonly message: string };

export interface IdentityFactory {
  next(scope: "board" | "stage" | "mutation" | "command"): string;
}

export function createBrowserIdentityFactory(): IdentityFactory {
  return {
    next(scope) {
      return `${scope}:${crypto.randomUUID()}`;
    },
  };
}

export function selectableCatalogEntries(
  catalog: WorkflowCatalogProjection,
): readonly SkillCatalogEntry[] {
  return catalog.catalog.entries.filter((entry) => (
    !entry.hasNameCollision
    && !entry.diagnostics.some(({ severity }) => severity === "error")
  ));
}

export function stageConfigurationReason(
  stage: StageProjection,
  catalog: WorkflowCatalogProjection,
): string | null {
  if (!stage.configured || stage.defaultSkillId === null) {
    return "Default Workflow Skill not selected. This stage cannot launch work.";
  }
  if (!selectableCatalogEntries(catalog).some(({ skillId }) => skillId === stage.defaultSkillId)) {
    return "The selected Workflow Skill is no longer valid in the local catalog. Choose another Skill before running work.";
  }
  return null;
}

export function cardMovementAffordance(
  projection: WorkflowBoardProjection,
  card: CardProjection,
): {
  readonly allowed: boolean;
  readonly targetStageId: StageId | null;
  readonly reason: string;
} {
  if (projection.board === null) {
    return { allowed: false, targetStageId: null, reason: "Workflow Board is not configured." };
  }
  const arrow = deriveImmediateSuccessorArrows(
    projection.board,
    projection.stages,
    projection.edges,
  ).find(({ sourceStageId }) => sourceStageId === card.stageId);
  if (card.executionStatus === "running" || card.executionStatus === "needs_attention") {
    return {
      allowed: false,
      targetStageId: arrow?.targetStageId ?? null,
      reason: `Stage Lock: movement is disabled while Execution Status is ${card.executionStatus}.`,
    };
  }
  if (arrow === undefined) {
    return { allowed: false, targetStageId: null, reason: "No committed immediate successor is available." };
  }
  return { allowed: true, targetStageId: arrow.targetStageId, reason: "Move to the immediate successor." };
}

async function execute(
  client: DesktopRpcClient,
  command: WorkflowCommand,
  identities: IdentityFactory,
): Promise<WorkflowCommandRpcResult> {
  return (await client.executeWorkflowCommand(identities.next("command"), command)).result;
}

function mutationId(identities: IdentityFactory) {
  return workflowIds.mutation(identities.next("mutation"));
}

export async function createBlankBoard(
  client: DesktopRpcClient,
  projection: WorkflowBoardProjection,
  repositoryPath: string,
  identities: IdentityFactory,
): Promise<BoardInteractionResult> {
  if (projection.board !== null || projection.stages.length > 0) {
    return { status: "invalid", message: "Setup is available only for a blank Workflow Board." };
  }
  if (repositoryPath.trim().length === 0) {
    return { status: "invalid", message: "Choose a trusted repository before creating the board." };
  }
  return execute(client, {
    kind: "bind_repository",
    mutationId: mutationId(identities),
    boardId: workflowIds.board(identities.next("board")),
    repositoryPath: repositoryPath.trim(),
  }, identities);
}

export async function applyStarterTemplate(
  client: DesktopRpcClient,
  projection: WorkflowBoardProjection,
  repositoryPath: string,
  stageLabels: readonly string[],
  identities: IdentityFactory,
): Promise<BoardInteractionResult> {
  if (stageLabels.length === 0 || stageLabels.some((label) => label.trim().length === 0)) {
    return { status: "invalid", message: "Every starter stage needs a label." };
  }
  const created = await createBlankBoard(client, projection, repositoryPath, identities);
  if (created.status !== "ok") return created;

  let current = created.projection;
  for (const label of stageLabels) {
    const board = current.board;
    if (board === null) return { status: "invalid", message: "The host did not return the created board." };
    const result = await execute(client, {
      kind: "create_stage",
      mutationId: mutationId(identities),
      boardId: board.boardId,
      expectedWorkflowVersion: board.workflowVersion,
      stageId: workflowIds.stage(identities.next("stage")),
      label: label.trim(),
    }, identities);
    if (result.status !== "ok") return result;
    current = result.projection;
  }
  const board = current.board;
  if (board === null) return { status: "invalid", message: "The host did not return the created board." };
  return execute(client, {
    kind: "connect_stages",
    mutationId: mutationId(identities),
    boardId: board.boardId,
    expectedWorkflowVersion: board.workflowVersion,
    edges: current.stages.slice(0, -1).map((source, index) => ({
      sourceStageId: source.stageId,
      targetStageId: current.stages[index + 1]!.stageId,
    })),
  }, identities);
}

export async function createStageWithCatalogSkill(
  client: DesktopRpcClient,
  projection: WorkflowBoardProjection,
  label: string,
  defaultSkillId: SkillId | null,
  catalog: WorkflowCatalogProjection,
  identities: IdentityFactory,
): Promise<BoardInteractionResult> {
  const board = projection.board;
  if (board === null) return { status: "invalid", message: "Create the Workflow Board before adding stages." };
  if (label.trim().length === 0) return { status: "invalid", message: "Stage name is required." };
  if (
    defaultSkillId !== null
    && !selectableCatalogEntries(catalog).some(({ skillId }) => skillId === defaultSkillId)
  ) {
    return { status: "invalid", message: "Choose a valid Workflow Skill from the local catalog." };
  }

  const stageId = workflowIds.stage(identities.next("stage"));
  const created = await execute(client, {
    kind: "create_stage",
    mutationId: mutationId(identities),
    boardId: board.boardId,
    expectedWorkflowVersion: board.workflowVersion,
    stageId,
    label: label.trim(),
  }, identities);
  if (created.status !== "ok" || defaultSkillId === null) return created;
  const updatedBoard = created.projection.board;
  if (updatedBoard === null) return { status: "invalid", message: "The host did not return the created board." };
  return execute(client, {
    kind: "assign_stage_skill",
    mutationId: mutationId(identities),
    boardId: updatedBoard.boardId,
    expectedWorkflowVersion: updatedBoard.workflowVersion,
    stageId,
    defaultSkillId,
  }, identities);
}

export async function assignCatalogSkillToStage(
  client: DesktopRpcClient,
  projection: WorkflowBoardProjection,
  stageId: StageId,
  defaultSkillId: SkillId,
  catalog: WorkflowCatalogProjection,
  identities: IdentityFactory,
): Promise<BoardInteractionResult> {
  const board = projection.board;
  if (board === null) return { status: "invalid", message: "Create the Workflow Board before configuring stages." };
  if (!selectableCatalogEntries(catalog).some(({ skillId }) => skillId === defaultSkillId)) {
    return { status: "invalid", message: "Choose a valid Workflow Skill from the local catalog." };
  }
  if (!projection.stages.some((stage) => stage.stageId === stageId)) {
    return { status: "invalid", message: "The selected stage is no longer on this Workflow Board." };
  }
  return execute(client, {
    kind: "assign_stage_skill",
    mutationId: mutationId(identities),
    boardId: board.boardId,
    expectedWorkflowVersion: board.workflowVersion,
    stageId,
    defaultSkillId,
  }, identities);
}

export async function executeBoardCommand(
  client: DesktopRpcClient,
  command: WorkflowCommand,
  identities: IdentityFactory,
): Promise<WorkflowCommandRpcResult> {
  return execute(client, command, identities);
}

export function reorderStagesCommand(
  intent: StageReorderIntent,
  identities: IdentityFactory,
): WorkflowCommand {
  return {
    kind: "reorder_stages",
    mutationId: mutationId(identities),
    boardId: intent.boardId,
    expectedWorkflowVersion: intent.expectedWorkflowVersion,
    orderedStageIds: intent.orderedStageIds,
  };
}

export function connectStagesCommand(
  projection: WorkflowBoardProjection,
  identities: IdentityFactory,
): WorkflowCommand | null {
  const board = projection.board;
  if (board === null || projection.stages.length < 2) return null;
  return {
    kind: "connect_stages",
    mutationId: mutationId(identities),
    boardId: board.boardId,
    expectedWorkflowVersion: board.workflowVersion,
    edges: projection.stages.slice(0, -1).map((source, index) => ({
      sourceStageId: source.stageId,
      targetStageId: projection.stages[index + 1]!.stageId,
    })),
  };
}

export function moveCardCommand(
  projection: WorkflowBoardProjection,
  card: CardProjection,
  targetStageId: StageId,
  identities: IdentityFactory,
): WorkflowCommand | null {
  const board = projection.board;
  const movement = cardMovementAffordance(projection, card);
  if (board === null || !movement.allowed || movement.targetStageId !== targetStageId) return null;
  return {
    kind: "move_card",
    mutationId: mutationId(identities),
    boardId: board.boardId,
    expectedWorkflowVersion: board.workflowVersion,
    cardId: card.cardId,
    expectedCardVersion: card.version,
    targetStageId,
  };
}

export function boardInteractionMessage(result: BoardInteractionResult): string | null {
  switch (result.status) {
    case "ok":
      return null;
    case "invalid":
      return result.message;
    case "conflict":
      return result.conflict.kind === "stale_workflow"
        ? `Workflow changed before this action was committed. Expected version ${result.conflict.expectedVersion}, now ${result.conflict.actualVersion}. Review the refreshed board and try again.`
        : `Card changed before this action was committed. Expected version ${result.conflict.expectedVersion}, now ${result.conflict.actualVersion}. Review the refreshed card and try again.`;
    case "rejected":
      return `${result.rejection.message}. Review the current board and try again.`;
    case "unavailable":
      return "The desktop host could not apply this action. Wait for it to reconnect, then try again.";
  }
}
