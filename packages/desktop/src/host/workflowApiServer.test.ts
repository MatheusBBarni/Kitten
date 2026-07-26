import { describe, expect, test } from "bun:test";
import type { PersistenceSnapshot } from "../persistence/eventJournal.ts";
import { workflowIds } from "../workflow/workflowTypes.ts";
import { workflowCommandForApi, workflowApiManifestPath } from "./workflowApiServer.ts";

const boardId = workflowIds.board("board:main");
const cardId = workflowIds.card("card:review-ui");
const sourceStageId = workflowIds.stage("stage:todo");
const targetStageId = workflowIds.stage("stage:ready");
const moveMutationId = workflowIds.mutation("move-review-ui");
const createStageMutationId = workflowIds.mutation("add-done");

const snapshot = {
  boards: [{ boardId, repositoryPath: "/repo", workflowVersion: 7, createdAt: 1, updatedAt: 1 }],
  cards: [{
    cardId,
    boardId,
    stageId: sourceStageId,
    title: "Review UI",
    description: "",
    provider: "codex",
    model: "gpt-5.6",
    effort: "high",
    skillOverrideId: null,
    runnable: true,
    executionStatus: "idle",
    version: 4,
    createdAt: 1,
    updatedAt: 1,
  }],
} as unknown as PersistenceSnapshot;

describe("workflow API command construction", () => {
  test("uses taskId aliases and current projection versions for card moves", () => {
    expect(workflowCommandForApi(snapshot, "move_card", {
      boardId,
      taskId: cardId,
      targetStageId,
      mutationId: moveMutationId,
    })).toEqual({
      kind: "move_card",
      mutationId: moveMutationId,
      boardId,
      cardId,
      targetStageId,
      expectedWorkflowVersion: 7,
      expectedCardVersion: 4,
    });
  });

  test("does not require a card identity for stage actions", () => {
    expect(workflowCommandForApi(snapshot, "create_stage", {
      boardId,
      stageId: "stage:done",
      label: "Done",
      mutationId: createStageMutationId,
    })).toMatchObject({
      kind: "create_stage",
      mutationId: createStageMutationId,
      boardId,
      expectedWorkflowVersion: 7,
      stageId: "stage:done",
      label: "Done",
    });
  });

  test("uses a stable per-user manifest location", () => {
    expect(workflowApiManifestPath("/Users/example")).toBe("/Users/example/.kitten/workflow-api.json");
  });
});
