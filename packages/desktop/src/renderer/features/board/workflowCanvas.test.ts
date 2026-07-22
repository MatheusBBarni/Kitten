import { describe, expect, test } from "bun:test";
import {
  workflowIds,
  type BoardProjection,
  type EdgeProjection,
  type StageProjection,
} from "../../../workflow/workflowTypes.ts";
import {
  connectOrderedPathIntent,
  deriveImmediateSuccessorArrows,
  isCommittedOrderedPath,
  keyboardStageReorderIntent,
  pointerStageReorderIntent,
} from "./workflowCanvas.ts";

const boardId = workflowIds.board("board-canvas");
const backlogId = workflowIds.stage("stage-backlog");
const doingId = workflowIds.stage("stage-doing");
const reviewId = workflowIds.stage("stage-review");
const board: BoardProjection = {
  boardId,
  repositoryPath: "/repo",
  workflowVersion: 7,
  createdAt: 1,
  updatedAt: 7,
};
const stages: readonly StageProjection[] = [
  { stageId: reviewId, boardId, label: "Review", position: 2, defaultSkillId: null, configured: false, workflowVersion: 7, updatedAt: 7 },
  { stageId: backlogId, boardId, label: "Backlog", position: 0, defaultSkillId: null, configured: false, workflowVersion: 7, updatedAt: 7 },
  { stageId: doingId, boardId, label: "Doing", position: 1, defaultSkillId: null, configured: false, workflowVersion: 7, updatedAt: 7 },
];

describe("projected workflow canvas", () => {
  test("shows only current committed immediate-successor arrows", () => {
    const edges: readonly EdgeProjection[] = [
      { boardId, sourceStageId: backlogId, targetStageId: doingId, workflowVersion: 7 },
      { boardId, sourceStageId: doingId, targetStageId: reviewId, workflowVersion: 7 },
      { boardId, sourceStageId: backlogId, targetStageId: reviewId, workflowVersion: 7 },
      { boardId, sourceStageId: reviewId, targetStageId: backlogId, workflowVersion: 6 },
    ];

    expect(deriveImmediateSuccessorArrows(board, stages, edges)).toEqual([
      { sourceStageId: backlogId, targetStageId: doingId, workflowVersion: 7 },
      { sourceStageId: doingId, targetStageId: reviewId, workflowVersion: 7 },
    ]);
    expect(isCommittedOrderedPath(board, stages, edges)).toBeTrue();
    expect(isCommittedOrderedPath(board, stages, edges.slice(1))).toBeFalse();
  });

  test("creates stable version-fenced keyboard and pointer reorder intents", () => {
    expect(keyboardStageReorderIntent(board, stages, doingId, "previous")).toEqual({
      boardId,
      expectedWorkflowVersion: 7,
      orderedStageIds: [doingId, backlogId, reviewId],
      movedStageId: doingId,
    });
    expect(pointerStageReorderIntent(board, stages, backlogId, reviewId, "after")).toEqual({
      boardId,
      expectedWorkflowVersion: 7,
      orderedStageIds: [doingId, reviewId, backlogId],
      movedStageId: backlogId,
    });
    expect(keyboardStageReorderIntent(board, stages, backlogId, "previous")).toBeNull();
    expect(pointerStageReorderIntent(board, stages, doingId, doingId, "before")).toBeNull();
  });

  test("proposes one complete adjacent path and no branch choices", () => {
    expect(connectOrderedPathIntent(board, stages)).toEqual({
      boardId,
      expectedWorkflowVersion: 7,
      edges: [
        { sourceStageId: backlogId, targetStageId: doingId },
        { sourceStageId: doingId, targetStageId: reviewId },
      ],
    });
  });
});
