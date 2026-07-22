import type {
  BoardProjection,
  EdgeProjection,
  StageId,
  StageProjection,
} from "../../../workflow/workflowTypes.ts";

export interface CanvasArrow {
  readonly sourceStageId: StageId;
  readonly targetStageId: StageId;
  readonly workflowVersion: number;
}

export interface StageReorderIntent {
  readonly boardId: BoardProjection["boardId"];
  readonly expectedWorkflowVersion: number;
  readonly orderedStageIds: readonly StageId[];
  readonly movedStageId: StageId;
}

export interface ConnectOrderedPathIntent {
  readonly boardId: BoardProjection["boardId"];
  readonly expectedWorkflowVersion: number;
  readonly edges: readonly {
    readonly sourceStageId: StageId;
    readonly targetStageId: StageId;
  }[];
}

export function orderedProjectedStages(
  stages: readonly StageProjection[],
): readonly StageProjection[] {
  return [...stages].sort(
    (left, right) => left.position - right.position || left.stageId.localeCompare(right.stageId),
  );
}

/**
 * The renderer draws only host-committed edges that match adjacent stages in
 * the current ordered projection. Invalid or stale graph shapes stay hidden
 * and remain the host's responsibility to reject or repair.
 */
export function deriveImmediateSuccessorArrows(
  board: BoardProjection,
  stages: readonly StageProjection[],
  edges: readonly EdgeProjection[],
): readonly CanvasArrow[] {
  const ordered = orderedProjectedStages(stages);
  const committed = new Set(
    edges
      .filter((edge) => edge.boardId === board.boardId && edge.workflowVersion === board.workflowVersion)
      .map((edge) => `${edge.sourceStageId}\0${edge.targetStageId}`),
  );

  return ordered.slice(0, -1).flatMap((source, index): CanvasArrow[] => {
    const target = ordered[index + 1];
    if (target === undefined || !committed.has(`${source.stageId}\0${target.stageId}`)) return [];
    return [{
      sourceStageId: source.stageId,
      targetStageId: target.stageId,
      workflowVersion: board.workflowVersion,
    }];
  });
}

export function isCommittedOrderedPath(
  board: BoardProjection,
  stages: readonly StageProjection[],
  edges: readonly EdgeProjection[],
): boolean {
  const requiredArrowCount = Math.max(orderedProjectedStages(stages).length - 1, 0);
  return deriveImmediateSuccessorArrows(board, stages, edges).length === requiredArrowCount;
}

function reorder(
  board: BoardProjection,
  stages: readonly StageProjection[],
  movedStageId: StageId,
  targetIndex: number,
): StageReorderIntent | null {
  const orderedStageIds = orderedProjectedStages(stages).map(({ stageId }) => stageId);
  const sourceIndex = orderedStageIds.indexOf(movedStageId);
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= orderedStageIds.length || sourceIndex === targetIndex) {
    return null;
  }
  orderedStageIds.splice(sourceIndex, 1);
  orderedStageIds.splice(targetIndex, 0, movedStageId);
  return {
    boardId: board.boardId,
    expectedWorkflowVersion: board.workflowVersion,
    orderedStageIds,
    movedStageId,
  };
}

export function keyboardStageReorderIntent(
  board: BoardProjection,
  stages: readonly StageProjection[],
  stageId: StageId,
  direction: "previous" | "next",
): StageReorderIntent | null {
  const ordered = orderedProjectedStages(stages);
  const currentIndex = ordered.findIndex((stage) => stage.stageId === stageId);
  return reorder(board, ordered, stageId, currentIndex + (direction === "previous" ? -1 : 1));
}

export function pointerStageReorderIntent(
  board: BoardProjection,
  stages: readonly StageProjection[],
  movedStageId: StageId,
  targetStageId: StageId,
  placement: "before" | "after",
): StageReorderIntent | null {
  const ordered = orderedProjectedStages(stages);
  const sourceIndex = ordered.findIndex((stage) => stage.stageId === movedStageId);
  const targetIndex = ordered.findIndex((stage) => stage.stageId === targetStageId);
  if (sourceIndex < 0 || targetIndex < 0 || movedStageId === targetStageId) return null;
  const adjustedTarget = placement === "before"
    ? targetIndex - (sourceIndex < targetIndex ? 1 : 0)
    : targetIndex + (sourceIndex > targetIndex ? 1 : 0);
  return reorder(board, ordered, movedStageId, adjustedTarget);
}

export function connectOrderedPathIntent(
  board: BoardProjection,
  stages: readonly StageProjection[],
): ConnectOrderedPathIntent {
  const ordered = orderedProjectedStages(stages);
  return {
    boardId: board.boardId,
    expectedWorkflowVersion: board.workflowVersion,
    edges: ordered.slice(0, -1).map((source, index) => ({
      sourceStageId: source.stageId,
      targetStageId: ordered[index + 1]!.stageId,
    })),
  };
}
