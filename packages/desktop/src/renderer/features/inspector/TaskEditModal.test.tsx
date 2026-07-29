import { afterEach, describe, expect, test } from "bun:test";
import "../../settings/testDom.ts";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { workflowIds } from "../../../workflow/workflowTypes.ts";
import type { CardEditInput } from "../board/boardInteractions.ts";
import { TaskEditModal } from "./TaskEditModal.tsx";

afterEach(cleanup);

const skillId = workflowIds.skill(`skill:${"d".repeat(64)}`);

describe("TaskEditModal", () => {
  test("selects a task-owned Skill and saves the task as runnable", async () => {
    const saved: CardEditInput[] = [];
    const user = userEvent.setup();
    const view = render(
      <TaskEditModal
        card={{
          cardId: workflowIds.card("task-edit-card"),
          boardId: workflowIds.board("task-edit-board"),
          stageId: workflowIds.stage("task-edit-stage"),
          title: "Review the UI",
          description: "Check the current behavior",
          provider: "codex",
          model: "gpt-5.6",
          effort: "high",
          skillOverrideId: null,
          runnable: false,
          executionStatus: "idle",
          version: 1,
          createdAt: 1,
          updatedAt: 1,
        }}
        catalog={{
          kind: "workflow_catalog_projection",
          revision: 1,
          catalog: {
            catalogId: "default",
            roots: [],
            diagnostics: [],
            entries: [{
              skillId,
              canonicalPath: "/repo/.agents/skills/review/SKILL.md",
              rootClass: "project",
              rootPath: "/repo/.agents/skills",
              digest: "d".repeat(64),
              metadata: {
                name: "review-task",
                description: "Review a task",
                frontmatter: {},
              },
              order: 0,
              hasNameCollision: false,
              diagnostics: [],
            }],
          },
        }}
        isOpen
        busy={false}
        onOpenChange={() => {}}
        onSave={(input) => saved.push(input)}
      />,
    );

    const runnable = view.getByRole("checkbox", { name: "Runnable task" });
    expect((runnable as HTMLInputElement).disabled).toBeTrue();
    await user.click(view.getByRole("button", { name: /Workflow Skill/ }));
    await user.click(view.getByRole("option", { name: "review-task (project)" }));
    expect((runnable as HTMLInputElement).disabled).toBeFalse();
    await user.click(runnable);
    await user.click(view.getByRole("button", { name: "Save task" }));

    expect(saved).toEqual([{
      title: "Review the UI",
      description: "Check the current behavior",
      provider: "codex",
      model: "gpt-5.6",
      effort: "high",
      skillOverrideId: skillId,
      runnable: true,
    }]);
  });
});
