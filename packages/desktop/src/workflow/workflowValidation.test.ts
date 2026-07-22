import { describe, expect, test } from "bun:test";
import type { EdgeProjection, StageProjection } from "./workflowTypes.ts";
import { workflowIds } from "./workflowTypes.ts";
import {
  immediateSuccessor,
  sortStagesByPosition,
  validateLinearWorkflow,
} from "./workflowValidation.ts";

const BOARD_ID = workflowIds.board("board-validation");

function stage(name: string, position: number): StageProjection {
  return {
    stageId: workflowIds.stage(`stage-${name.toLowerCase().replaceAll(" ", "-")}`),
    boardId: BOARD_ID,
    label: name,
    position,
    defaultSkillId: null,
    configured: false,
    workflowVersion: 1,
    updatedAt: 1,
  };
}

function edge(source: StageProjection, target: StageProjection): EdgeProjection {
  return {
    boardId: BOARD_ID,
    sourceStageId: source.stageId,
    targetStageId: target.stageId,
    workflowVersion: 1,
  };
}

describe("linear workflow validation", () => {
  test("accepts the editable starter path and a custom single-stage path", () => {
    const stages = ["Backlog", "To-do", "Refinement", "Ready", "Doing", "Finished", "Closed"]
      .map(stage);
    const edges = stages.slice(0, -1).map((source, index) => edge(source, stages[index + 1]!));

    expect(validateLinearWorkflow(stages, edges)).toEqual({
      valid: true,
      orderedStageIds: stages.map(({ stageId }) => stageId),
    });

    const custom = stage("Review", 0);
    expect(validateLinearWorkflow([custom], [])).toEqual({
      valid: true,
      orderedStageIds: [custom.stageId],
    });
    expect(immediateSuccessor(custom.stageId, [])).toBeNull();
  });

  test("rejects disconnected, branched, joined, and cyclic graphs", () => {
    const [a, b, c, d] = [stage("A", 0), stage("B", 1), stage("C", 2), stage("D", 3)];
    expect(validateLinearWorkflow([a, b, c, d], [edge(a, b), edge(c, d)])).toMatchObject({
      valid: false,
      error: { kind: "disconnected" },
    });
    expect(validateLinearWorkflow([a, b, c], [edge(a, b), edge(a, c)])).toMatchObject({
      valid: false,
      error: { kind: "branch", stageId: a.stageId },
    });
    expect(validateLinearWorkflow([a, b, c], [edge(a, c), edge(b, c)])).toMatchObject({
      valid: false,
      error: { kind: "join", stageId: c.stageId },
    });
    expect(validateLinearWorkflow([a, b, c], [edge(a, b), edge(b, c), edge(c, a)])).toMatchObject({
      valid: false,
      error: { kind: "cycle" },
    });
  });

  test("rejects unknown, self, and duplicate edges and orders equal positions deterministically", () => {
    const a = stage("A", 1);
    const b = stage("B", 1);
    const unknown = stage("Unknown", 2);
    expect(validateLinearWorkflow([a, b], [edge(a, unknown)])).toMatchObject({
      valid: false,
      error: { kind: "unknown_stage" },
    });
    expect(validateLinearWorkflow([a], [edge(a, a)])).toMatchObject({
      valid: false,
      error: { kind: "self_edge" },
    });
    expect(validateLinearWorkflow([a, b], [edge(a, b), edge(a, b)])).toMatchObject({
      valid: false,
      error: { kind: "duplicate_edge" },
    });
    expect(sortStagesByPosition([b, a]).map(({ stageId }) => stageId)).toEqual(
      [a, b].sort((left, right) => left.stageId.localeCompare(right.stageId)).map(({ stageId }) => stageId),
    );
    expect(immediateSuccessor(a.stageId, [edge(a, b)])).toBe(b.stageId);
  });
});
