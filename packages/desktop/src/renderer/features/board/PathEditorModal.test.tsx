import { afterEach, describe, expect, test } from "bun:test";
import "../../settings/testDom.ts";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WorkflowBoardProjection } from "../../../shared/rpc.ts";
import { workflowIds, type StageProjection } from "../../../workflow/workflowTypes.ts";
import { constrainStagePosition, PathEditorModal, workflowConnectionPath } from "./PathEditorModal.tsx";

afterEach(cleanup);

const boardId = workflowIds.board("board-path-editor");
const stageIds = ["backlog", "doing", "done"].map((name) => workflowIds.stage(`stage-${name}`));
const stages: readonly StageProjection[] = ["Backlog", "Doing", "Done"].map((label, position) => ({
  stageId: stageIds[position]!,
  boardId,
  label,
  position,
  defaultSkillId: null,
  configured: false,
  workflowVersion: 4,
  updatedAt: 4,
}));
const projection: WorkflowBoardProjection = {
  kind: "workflow_board_projection",
  revision: 4,
  board: { boardId, repositoryPath: "/repo", workflowVersion: 4, createdAt: 1, updatedAt: 4 },
  stages,
  edges: [
    { boardId, sourceStageId: stageIds[0]!, targetStageId: stageIds[1]!, workflowVersion: 4 },
    { boardId, sourceStageId: stageIds[1]!, targetStageId: stageIds[2]!, workflowVersion: 4 },
  ],
  cards: [],
};

describe("PathEditorModal", () => {
  test("routes non-adjacent and backward connections outside the stage cards", () => {
    expect(workflowConnectionPath(stages, stageIds[0]!, stageIds[2]!)).toContain(" 72");
    expect(workflowConnectionPath(stages, stageIds[2]!, stageIds[1]!)).toContain(" 312");
    expect(workflowConnectionPath(stages, stageIds[0]!, stageIds[1]!)).not.toContain(" L ");
  });

  test("constrains freely dragged stage cards to the canvas", () => {
    expect(constrainStagePosition({ x: 48, y: 136 }, { x: 50, y: 40 }, 912)).toEqual({ x: 98, y: 176 });
    expect(constrainStagePosition({ x: 48, y: 136 }, { x: -200, y: -200 }, 912)).toEqual({ x: 48, y: 48 });
    expect(constrainStagePosition({ x: 688, y: 224 }, { x: 200, y: 200 }, 912)).toEqual({ x: 688, y: 224 });
  });

  test("shows the ordered path as a canvas and saves disconnected edges", async () => {
    const user = userEvent.setup();
    const saved: unknown[] = [];
    const view = render(
      <PathEditorModal
        projection={projection}
        busy={false}
        onClose={() => {}}
        onSave={(edges) => saved.push(edges)}
      />,
    );

    expect(await view.findByRole("dialog", { name: "Edit workflow path" })).toBeDefined();
    expect(view.getByLabelText("Workflow path canvas")).toBeDefined();
    expect(view.getByText("2 of 2 connections")).toBeDefined();
    expect(view.getByRole("button", { name: "Save path" }).hasAttribute("disabled")).toBeTrue();

    await user.click(view.getByRole("button", { name: "Remove connection from Backlog to Doing" }));
    expect(view.getByText("1 of 2 connections")).toBeDefined();
    expect(view.getByText(/tasks cannot run until every stage forms one continuous path/i)).toBeDefined();
    await user.click(view.getByRole("button", { name: "Save path" }));

    expect(saved).toEqual([[
      { sourceStageId: stageIds[1], targetStageId: stageIds[2] },
    ]]);
  });

  test("clears the path and preserves the explicit incomplete state", async () => {
    const user = userEvent.setup();
    const saved: unknown[] = [];
    const view = render(
      <PathEditorModal
        projection={projection}
        busy={false}
        onClose={() => {}}
        onSave={(edges) => saved.push(edges)}
      />,
    );

    await user.click(view.getByRole("button", { name: "Clear path" }));
    expect(view.getByText("0 of 2 connections")).toBeDefined();
    await user.click(view.getByRole("button", { name: "Save path" }));
    expect(saved).toEqual([[]]);
  });

  test("connects arbitrary stages with keyboard-operable handles and rejects cycles", async () => {
    const user = userEvent.setup();
    const view = render(
      <PathEditorModal projection={projection} busy={false} onClose={() => {}} onSave={() => {}} />,
    );

    await user.click(view.getByRole("button", { name: "Start connection from Done" }));
    await user.click(view.getByRole("button", { name: "Connect to Backlog" }));
    expect(view.getByText("The workflow contains a cycle")).toBeDefined();
    expect(view.getByText("2 of 2 connections")).toBeDefined();

    await user.click(view.getByRole("button", { name: "Remove connection from Backlog to Doing" }));
    await user.click(view.getByRole("button", { name: "Start connection from Backlog" }));
    await user.click(view.getByRole("button", { name: "Connect to Done" }));
    expect(view.getByRole("button", { name: "Remove connection from Backlog to Done" })).toBeDefined();
    expect(view.queryByRole("button", { name: "Remove connection from Doing to Done" })).toBeNull();
  });
});
