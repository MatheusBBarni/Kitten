import type { EventJournal, PersistenceSnapshot } from "../persistence/eventJournal.ts";
import { readCatalogProjection } from "../catalog/catalogProjection.ts";
import type { WorkflowCommandHandler } from "../workflow/workflowCommands.ts";
import type { BoardId, WorkflowCommand } from "../workflow/workflowTypes.ts";
import {
  createWorkflowBoardEnvelope,
  createWorkflowCatalogEnvelope,
  createWorkflowCommandEnvelope,
  type WorkflowBoardEnvelope,
  type WorkflowBoardProjection,
  type WorkflowCatalogEnvelope,
  type WorkflowCatalogProjection,
  type WorkflowCommandEnvelope,
} from "../shared/rpc.ts";

export interface DesktopBoardRpc {
  getBoard(params: { readonly boardId?: string }): Promise<WorkflowBoardEnvelope>;
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
): WorkflowBoardProjection {
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
): DesktopBoardRpc {
  return {
    async getBoard({ boardId }) {
      return createWorkflowBoardEnvelope({
        status: "ok",
        projection: projectWorkflowBoard(journal.snapshot(), boardId),
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
      const projection = projectWorkflowBoard(journal.snapshot(), command.boardId as BoardId);
      return createWorkflowCommandEnvelope(commandId, {
        status: "ok",
        outcome: result.status,
        projection,
      });
    },
  };
}
