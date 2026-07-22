import { afterEach, describe, expect, test } from "bun:test";
import "../../settings/testDom.ts";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProfileId } from "@kitten/engine";
import { workflowIds } from "../../../workflow/workflowTypes.ts";
import { TaskCreateModal } from "./TaskCreateModal.tsx";
import type { CardCreateInput } from "./boardInteractions.ts";

afterEach(cleanup);

const boardId = workflowIds.board("task-create-board");
const stageId = workflowIds.stage("task-create-stage");
const profileId = "profile-codex" as ProfileId;

describe("TaskCreateModal", () => {
  test("creates a task from ready defaults without doing async work in the component", async () => {
    const created: CardCreateInput[] = [];
    const user = userEvent.setup();
    const view = render(
      <TaskCreateModal
        stages={[{
          stageId,
          boardId,
          label: "Backlog",
          position: 0,
          defaultSkillId: null,
          configured: true,
          workflowVersion: 1,
          updatedAt: 1,
        }]}
        catalog={{
          kind: "workflow_catalog_projection",
          revision: 1,
          catalog: { catalogId: "default", roots: [], entries: [], diagnostics: [] },
        }}
        profiles={[{
          profileId,
          provider: "Codex",
          models: ["gpt-5.6"],
          efforts: ["high"],
          readiness: { ready: true, protocolVersion: 1 },
        }]}
        providers={[{
          providerId: "codex",
          displayName: "Codex",
          configuredBy: "kitten_default",
          configuredCommand: "npx",
          detectedCommands: ["codex"],
          models: ["gpt-5.6"],
          efforts: ["high"],
          availability: "available",
        }]}
        defaults={{ profileId, model: "gpt-5.6", effort: "high", appliesTo: "future_cards" }}
        busy={false}
        onClose={() => {}}
        onCreate={(input) => created.push(input)}
      />,
    );

    await user.type(view.getByRole("textbox", { name: "Title" }), "Audit retry handling");
    await user.type(view.getByRole("textbox", { name: "Description (optional)" }), "Keep the event history intact.");
    expect(view.queryByRole("textbox", { name: "Agent provider" })).toBeNull();
    expect(view.queryByRole("textbox", { name: "Model" })).toBeNull();
    expect(view.queryByRole("textbox", { name: "Effort" })).toBeNull();
    expect(view.getByRole("button", { name: /Agent provider/ })).toBeDefined();
    expect(view.getByRole("button", { name: /Model/ })).toBeDefined();
    expect(view.getByRole("button", { name: /Effort/ })).toBeDefined();
    await user.click(view.getByRole("button", { name: "Create task" }));

    expect(created).toEqual([{
      stageId,
      title: "Audit retry handling",
      description: "Keep the event history intact.",
      provider: "Codex",
      model: "gpt-5.6",
      effort: "high",
      skillOverrideId: null,
      runnable: true,
    }]);
  });

  test("makes the no-ready-agent draft limitation explicit", () => {
    const view = render(
      <TaskCreateModal
        stages={[]}
        catalog={{
          kind: "workflow_catalog_projection",
          revision: 0,
          catalog: { catalogId: "default", roots: [], entries: [], diagnostics: [] },
        }}
        profiles={[]}
        providers={[{
          providerId: "claude-code",
          displayName: "Claude Code",
          configuredBy: "kitten_default",
          configuredCommand: "npx",
          detectedCommands: ["claude"],
          models: ["default", "sonnet", "opus"],
          efforts: ["default", "high"],
          availability: "available",
        }]}
        defaults={{ profileId: null, model: null, effort: null, appliesTo: "future_cards" }}
        busy={false}
        onClose={() => {}}
        onCreate={() => {}}
      />,
    );

    expect(view.getByText("No ready task agents")).toBeDefined();
    expect(view.getByText(/save a draft with a detected provider/)).toBeDefined();
    expect(view.getByRole("button", { name: /Agent provider/ })).toBeDefined();
    expect(view.getByRole("button", { name: /Model/ }).hasAttribute("disabled")).toBeFalse();
    expect(view.getByRole("button", { name: /Effort/ }).hasAttribute("disabled")).toBeFalse();
    expect(view.getByRole("button", { name: "Create task" }).hasAttribute("disabled")).toBeTrue();
  });

  test("saves a detected provider selection as a non-runnable draft without a certified profile", async () => {
    const user = userEvent.setup();
    const created: CardCreateInput[] = [];
    const view = render(
      <TaskCreateModal
        stages={[{
          stageId,
          boardId,
          label: "Backlog",
          position: 0,
          defaultSkillId: null,
          configured: true,
          workflowVersion: 1,
          updatedAt: 1,
        }]}
        catalog={{ kind: "workflow_catalog_projection", revision: 0, catalog: { catalogId: "default", roots: [], entries: [], diagnostics: [] } }}
        profiles={[]}
        providers={[{
          providerId: "claude-code",
          displayName: "Claude Code",
          configuredBy: "kitten_default",
          configuredCommand: "npx",
          detectedCommands: ["claude"],
          models: ["default", "sonnet"],
          efforts: ["default", "high"],
          availability: "available",
        }]}
        defaults={{ profileId: null, model: null, effort: null, appliesTo: "future_cards" }}
        busy={false}
        onClose={() => {}}
        onCreate={(input) => created.push(input)}
      />,
    );

    await user.type(view.getByRole("textbox", { name: "Title" }), "Draft task");
    await user.click(view.getByRole("button", { name: "Create task" }));
    expect(created).toEqual([expect.objectContaining({
      provider: "claude-code",
      model: "default",
      effort: "default",
      runnable: false,
    })]);
  });
});
