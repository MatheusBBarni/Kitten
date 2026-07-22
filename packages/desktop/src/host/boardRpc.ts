import type { EventJournal, PersistenceSnapshot } from "../persistence/eventJournal.ts";
import { readCatalogProjection } from "../catalog/catalogProjection.ts";
import type { WorkflowCommandHandler } from "../workflow/workflowCommands.ts";
import type { BoardId, WorkflowCommand } from "../workflow/workflowTypes.ts";
import {
  createWorkflowBoardEnvelope,
  createWorkflowCatalogEnvelope,
  createWorkflowCommandEnvelope,
  createWorkspaceEnvelope,
  type WorkflowBoardEnvelope,
  type WorkflowBoardProjection,
  type WorkflowCatalogEnvelope,
  type WorkflowCatalogProjection,
  type WorkflowCommandEnvelope,
  type WorkspaceEnvelope,
  type WorkspaceProjection,
} from "../shared/rpc.ts";

export interface DesktopBoardRpc {
  getBoard(params: { readonly boardId?: string; readonly mode?: "active" | "new" }): Promise<WorkflowBoardEnvelope>;
  getWorkspace?(params: { readonly knownRevision?: number }): Promise<WorkspaceEnvelope>;
  getCatalog(params: { readonly catalogId?: string }): Promise<WorkflowCatalogEnvelope>;
  executeWorkflowCommand(params: {
    readonly commandId: string;
    readonly command: WorkflowCommand;
  }): Promise<WorkflowCommandEnvelope>;
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
  } = {},
): DesktopBoardRpc {
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
