import type {
  BoardProjection,
  EdgeProjection,
  StageId,
  StageProjection,
} from "../../../workflow/workflowTypes.ts";
import { validateConfigurableWorkflowPath, validateLinearWorkflow } from "../../../workflow/workflowValidation.ts";

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
 * The renderer draws only current, host-committed edges between known stages.
 * Invalid or stale graph shapes fail closed instead of becoming movement affordances.
 */
export function deriveImmediateSuccessorArrows(
  board: BoardProjection,
  stages: readonly StageProjection[],
  edges: readonly EdgeProjection[],
): readonly CanvasArrow[] {
  const stageIds = new Set(stages.map(({ stageId }) => stageId));
  const committed = edges.filter((edge) => (
    edge.boardId === board.boardId
    && edge.workflowVersion === board.workflowVersion
    && stageIds.has(edge.sourceStageId)
    && stageIds.has(edge.targetStageId)
  ));
  if (!validateConfigurableWorkflowPath(stages, committed).valid) return [];
  return committed.map(({ sourceStageId, targetStageId, workflowVersion }) => ({
    sourceStageId,
    targetStageId,
    workflowVersion,
  }));
}

export function isCommittedOrderedPath(
  board: BoardProjection,
  stages: readonly StageProjection[],
  edges: readonly EdgeProjection[],
): boolean {
  const committed = deriveImmediateSuccessorArrows(board, stages, edges);
  return validateLinearWorkflow(stages, committed).valid;
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
