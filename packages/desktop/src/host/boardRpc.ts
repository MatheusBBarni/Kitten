import type { EventJournal, PersistenceSnapshot } from "../persistence/eventJournal.ts";
import { readCatalogProjection } from "../catalog/catalogProjection.ts";
import type { WorkflowCommandHandler } from "../workflow/workflowCommands.ts";
import type { BoardId, WorkflowCommand } from "../workflow/workflowTypes.ts";
import {
  SUPERVISION_STATUSES,
  createSupervisionEnvelope,
  createWorkflowBoardEnvelope,
  createWorkflowCatalogEnvelope,
  createWorkflowCommandEnvelope,
  createWorkspaceEnvelope,
  type ReviewEvidenceAvailability,
  type SupervisionEnvelope,
  type SupervisionItem,
  type SupervisionPriority,
  type SupervisionProjection,
  type SupervisionStatus,
  type WorkflowBoardEnvelope,
  type WorkflowBoardProjection,
  type WorkflowCatalogEnvelope,
  type WorkflowCatalogProjection,
  type WorkflowCommandEnvelope,
  type WorkspaceEnvelope,
  type WorkspaceProjection,
} from "../shared/rpc.ts";
import {
  recordWorkflowMeasurementSafely,
  type WorkflowMeasurementSink,
} from "./lifecycleDiagnostics.ts";
import {
  bucketCount,
  bucketDuration,
} from "./workflowMeasurement.ts";

export interface DesktopBoardRpc {
  getBoard(params: { readonly boardId?: string; readonly mode?: "active" | "new" }): Promise<WorkflowBoardEnvelope>;
  getWorkspace?(params: { readonly knownRevision?: number }): Promise<WorkspaceEnvelope>;
  getSupervision(params: { readonly knownRevision?: number }): Promise<SupervisionEnvelope>;
  getCatalog(params: { readonly catalogId?: string }): Promise<WorkflowCatalogEnvelope>;
  executeWorkflowCommand(params: {
    readonly commandId: string;
    readonly command: WorkflowCommand;
  }): Promise<WorkflowCommandEnvelope>;
}

const supervisionPriority: Readonly<Record<SupervisionStatus, SupervisionPriority>> = {
  needs_attention: 0,
  ready_for_review: 1,
  failed: 2,
  running: 3,
  settled: 4,
};

type SnapshotAttempt = PersistenceSnapshot["attempts"][number];
type SnapshotAttention = PersistenceSnapshot["attentionBlockers"][number];
type SnapshotEvidence = PersistenceSnapshot["reviewEvidenceByCard"][string];

function cardIdentity(boardId: string, cardId: string): string {
  return `${boardId}\u0000${cardId}`;
}

function attemptIdentity(
  boardId: string,
  cardId: string,
  attemptId: string,
  generation: number,
): string {
  return `${cardIdentity(boardId, cardId)}\u0000${attemptId}\u0000${generation}`;
}

function preferAttempt(candidate: SnapshotAttempt, current: SnapshotAttempt): boolean {
  return candidate.generation > current.generation
    || (
      candidate.generation === current.generation
      && (
        candidate.createdAt > current.createdAt
        || (
          candidate.createdAt === current.createdAt
          && candidate.attemptId.localeCompare(current.attemptId) < 0
        )
      )
    );
}

function preferAttention(candidate: SnapshotAttention, current: SnapshotAttention): boolean {
  return candidate.generation > current.generation
    || (
      candidate.generation === current.generation
      && (
        candidate.updatedAt > current.updatedAt
        || (
          candidate.updatedAt === current.updatedAt
          && (
            candidate.createdAt > current.createdAt
            || (
              candidate.createdAt === current.createdAt
              && candidate.blockerId.localeCompare(current.blockerId) < 0
            )
          )
        )
      )
    );
}

function availableEvidence(
  card: PersistenceSnapshot["cards"][number],
  attempt: SnapshotAttempt | null,
  evidence: SnapshotEvidence | undefined,
  finalStage: boolean,
): ReviewEvidenceAvailability {
  if (card.executionStatus !== "ready_for_review") {
    if (
      finalStage
      && card.executionStatus === "running"
      && attempt?.state === "succeeded"
    ) {
      return {
        status: "unavailable",
        error: {
          code: "evidence_missing",
          recoveryHint: "retry_evidence_capture",
        },
      };
    }
    return { status: "not_applicable" };
  }
  if (
    attempt !== null
    && attempt.state === "succeeded"
    && evidence !== undefined
    && evidence.boardId === card.boardId
    && evidence.cardId === card.cardId
    && evidence.attemptId === attempt.attemptId
    && evidence.generation === attempt.generation
  ) {
    return {
      status: "available",
      evidenceId: evidence.evidenceId,
      evidenceDigest: evidence.evidenceDigest,
    };
  }
  return {
    status: "unavailable",
    error: {
      code: "evidence_missing",
      recoveryHint: "retry_evidence_capture",
    },
  };
}

function supervisionGeneratedAt(snapshot: PersistenceSnapshot): number {
  let generatedAt = 0;
  for (const board of snapshot.boards) generatedAt = Math.max(generatedAt, board.updatedAt);
  for (const card of snapshot.cards) generatedAt = Math.max(generatedAt, card.updatedAt);
  for (const attempt of snapshot.attempts) {
    generatedAt = Math.max(
      generatedAt,
      attempt.createdAt,
      attempt.startedAt ?? 0,
      attempt.terminalAt ?? 0,
    );
  }
  for (const inspector of snapshot.attemptInspectors) {
    generatedAt = Math.max(generatedAt, inspector.updatedAt);
  }
  for (const attention of snapshot.attentionBlockers) {
    generatedAt = Math.max(generatedAt, attention.updatedAt);
  }
  for (const evidence of Object.values(snapshot.reviewEvidenceByCard)) {
    generatedAt = Math.max(generatedAt, evidence.createdAt);
  }
  return generatedAt;
}

export function projectSupervision(snapshot: PersistenceSnapshot): SupervisionProjection {
  const attemptsByCard = new Map<string, SnapshotAttempt>();
  for (const attempt of snapshot.attempts) {
    const identity = cardIdentity(attempt.boardId, attempt.cardId);
    const current = attemptsByCard.get(identity);
    if (current === undefined || preferAttempt(attempt, current)) {
      attemptsByCard.set(identity, attempt);
    }
  }

  const inspectorActivityByAttempt = new Map<string, number>();
  for (const inspector of snapshot.attemptInspectors) {
    const identity = attemptIdentity(
      inspector.boardId,
      inspector.cardId,
      inspector.attemptId,
      inspector.generation,
    );
    inspectorActivityByAttempt.set(
      identity,
      Math.max(inspectorActivityByAttempt.get(identity) ?? 0, inspector.updatedAt),
    );
  }

  const activeAttentionByCard = new Map<string, SnapshotAttention>();
  for (const attention of snapshot.attentionBlockers) {
    if (!attention.active) continue;
    const identity = cardIdentity(attention.boardId, attention.cardId);
    const attempt = attemptsByCard.get(identity);
    if (
      attempt === undefined
      || attempt.boardId !== attention.boardId
      || attempt.attemptId !== attention.attemptId
      || attempt.generation !== attention.generation
      || attempt.state !== "needs_attention"
    ) {
      continue;
    }
    const current = activeAttentionByCard.get(identity);
    if (current === undefined || preferAttention(attention, current)) {
      activeAttentionByCard.set(identity, attention);
    }
  }

  const itemsByStatus: Record<SupervisionStatus, SupervisionItem[]> = {
    needs_attention: [],
    ready_for_review: [],
    failed: [],
    running: [],
    settled: [],
  };

  for (const card of snapshot.cards) {
    const identity = cardIdentity(card.boardId, card.cardId);
    const attempt = attemptsByCard.get(identity) ?? null;
    const attention = activeAttentionByCard.get(identity);
    const status: SupervisionStatus = attention !== undefined
      || card.executionStatus === "needs_attention"
      ? "needs_attention"
      : card.executionStatus === "ready_for_review"
        ? "ready_for_review"
        : card.executionStatus === "failed"
          ? "failed"
          : card.executionStatus === "running"
            ? "running"
            : "settled";
    const evidence = snapshot.reviewEvidenceByCard[card.cardId];
    const finalStage = !snapshot.edges.some((edge) => (
      edge.boardId === card.boardId && edge.sourceStageId === card.stageId
    ));
    const evidenceAvailability = availableEvidence(card, attempt, evidence, finalStage);
    const actionableAt = status === "needs_attention"
      ? attention?.updatedAt ?? card.updatedAt
      : status === "ready_for_review"
        ? evidenceAvailability.status === "available" && evidence !== undefined
          ? evidence.createdAt
          : card.updatedAt
        : status === "failed"
          ? attempt?.terminalAt ?? card.updatedAt
          : status === "running"
            ? attempt === null
              ? card.updatedAt
              : Math.max(
                  attempt.createdAt,
                  attempt.startedAt ?? 0,
                  inspectorActivityByAttempt.get(attemptIdentity(
                    attempt.boardId,
                    attempt.cardId,
                    attempt.attemptId,
                    attempt.generation,
                  )) ?? 0,
                )
            : card.updatedAt;
    itemsByStatus[status].push({
      boardId: card.boardId,
      cardId: card.cardId,
      cardVersion: card.version,
      attemptId: attempt?.attemptId ?? null,
      generation: attempt?.generation ?? null,
      status,
      priority: supervisionPriority[status],
      evidenceAvailability,
      actionableAt,
      updatedAt: card.updatedAt,
    });
  }

  const groups = SUPERVISION_STATUSES.map((status) => {
    const items = itemsByStatus[status];
    items.sort((left, right) => (
      left.actionableAt === right.actionableAt
        ? left.boardId.localeCompare(right.boardId) || left.cardId.localeCompare(right.cardId)
        : left.actionableAt < right.actionableAt
          ? 1
          : -1
    ));
    return {
      status,
      priority: supervisionPriority[status],
      items,
    };
  });

  return {
    kind: "supervision_projection",
    schemaVersion: 1,
    revision: snapshot.revision,
    generatedAt: supervisionGeneratedAt(snapshot),
    groups,
    counts: Object.fromEntries(
      groups.map(({ status, items }) => [status, items.length]),
    ) as Record<SupervisionStatus, number>,
  };
}

function selectBoard(snapshot: PersistenceSnapshot, requestedBoardId?: string) {
  return requestedBoardId === undefined
    ? snapshot.boards[0] ?? null
    : snapshot.boards.find(({ boardId }) => boardId === requestedBoardId) ?? null;
}

export function projectWorkflowBoard(
  snapshot: PersistenceSnapshot,
  requestedBoardId?: string,
  mode: "active" | "new" = "active",
): WorkflowBoardProjection {
  if (mode === "new") {
    return {
      kind: "workflow_board_projection",
      revision: snapshot.revision,
      board: null,
      stages: [],
      edges: [],
      cards: [],
    };
  }
  const board = selectBoard(snapshot, requestedBoardId);
  if (board === null) {
    return {
      kind: "workflow_board_projection",
      revision: snapshot.revision,
      board: null,
      stages: [],
      edges: [],
      cards: [],
    };
  }
  const byPosition = [...snapshot.stages]
    .filter(({ boardId }) => boardId === board.boardId)
    .sort((left, right) => left.position - right.position || left.stageId.localeCompare(right.stageId));
  return {
    kind: "workflow_board_projection",
    revision: snapshot.revision,
    board,
    stages: byPosition,
    edges: snapshot.edges.filter(({ boardId }) => boardId === board.boardId),
    cards: snapshot.cards.filter(({ boardId }) => boardId === board.boardId),
  };
}

export function projectWorkspace(snapshot: PersistenceSnapshot): WorkspaceProjection {
  return {
    kind: "workspace_projection",
    revision: snapshot.revision,
    boards: [...snapshot.boards]
      .sort((left, right) => right.updatedAt - left.updatedAt || left.boardId.localeCompare(right.boardId))
      .map(({ boardId, repositoryPath, createdAt, updatedAt, workflowVersion }) => ({
        boardId,
        repositoryPath,
        createdAt,
        updatedAt,
        workflowVersion,
      })),
  };
}

export function projectWorkflowCatalog(
  snapshot: PersistenceSnapshot,
  catalogId = "default",
): WorkflowCatalogProjection {
  return {
    kind: "workflow_catalog_projection",
    revision: snapshot.revision,
    catalog: readCatalogProjection(snapshot, catalogId),
  };
}

export function createDesktopBoardRpc(
  journal: EventJournal,
  commands: WorkflowCommandHandler,
  options: {
    readonly onRepositoryBound?: (repositoryPath: string) => void;
    readonly onRepositoryOpened?: (repositoryPath: string) => void;
    readonly onProjectionCommitted?: (projection: WorkflowBoardProjection) => void;
    readonly measurement?: WorkflowMeasurementSink;
    readonly now?: () => number;
  } = {},
): DesktopBoardRpc {
  const now = options.now ?? Date.now;
  return {
    async getBoard({ boardId, mode }) {
      const projection = projectWorkflowBoard(journal.snapshot(), boardId, mode);
      if (projection.board !== null) {
        try {
          options.onRepositoryOpened?.(projection.board.repositoryPath);
        } catch {
          // Board reads remain available if catalog root refresh degrades.
        }
      }
      return createWorkflowBoardEnvelope({
        status: "ok",
        projection,
      });
    },
    async getWorkspace() {
      return createWorkspaceEnvelope({
        status: "ok",
        projection: projectWorkspace(journal.snapshot()),
      });
    },
    async getSupervision() {
      const startedAt = now();
      try {
        const snapshot = journal.snapshot();
        const projection = projectSupervision(snapshot);
        recordWorkflowMeasurementSafely(options.measurement, {
          schemaVersion: 1,
          name: "supervision_projection",
          outcome: "ok",
          durationBucket: bucketDuration(Math.max(0, now() - startedAt)),
          itemCountBucket: bucketCount(
            projection.groups.reduce((count, group) => count + group.items.length, 0),
          ),
        });
        return createSupervisionEnvelope({
          status: "ok",
          projection,
        });
      } catch (error) {
        recordWorkflowMeasurementSafely(options.measurement, {
          schemaVersion: 1,
          name: "supervision_projection",
          outcome: "failed",
          durationBucket: bucketDuration(Math.max(0, now() - startedAt)),
          itemCountBucket: "0",
        });
        throw error;
      }
    },
    async getCatalog({ catalogId }) {
      return createWorkflowCatalogEnvelope({
        status: "ok",
        projection: projectWorkflowCatalog(journal.snapshot(), catalogId),
      });
    },
    async executeWorkflowCommand({ commandId, command }) {
      const result = commands.execute(command);
      if (result.status === "conflict") {
        return createWorkflowCommandEnvelope(commandId, {
          status: "conflict",
          conflict: result.conflict,
        });
      }
      if (result.status === "rejected") {
        return createWorkflowCommandEnvelope(commandId, {
          status: "rejected",
          rejection: result.rejection,
        });
      }
      if (command.kind === "bind_repository") {
        try {
          options.onRepositoryBound?.(command.repositoryPath);
        } catch {
          // The committed board remains usable even if local catalog refresh degrades.
        }
      }
      const projection = projectWorkflowBoard(journal.snapshot(), command.boardId as BoardId);
      try {
        options.onProjectionCommitted?.(projection);
      } catch {
        // SQLite remains authoritative if a project-local configuration mirror cannot be refreshed.
      }
      return createWorkflowCommandEnvelope(commandId, {
        status: "ok",
        outcome: result.status,
        projection,
      });
    },
  };
}
