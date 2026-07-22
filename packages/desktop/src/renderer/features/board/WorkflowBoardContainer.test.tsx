import { afterEach, describe, expect, test } from "bun:test";
import "../../settings/testDom.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toast } from "@heroui/react";
import { cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DesktopRpcClient } from "../../client.ts";
import { createDesktopQueryClient } from "../../query/desktopQueries.ts";
import { resetDesktopViewStore } from "../../state/desktopViewStore.ts";
import {
  createRepositoryDirectoryPickerEnvelope,
  createWorkflowBoardEnvelope,
  createWorkflowCatalogEnvelope,
  createWorkspaceEnvelope,
  type WorkflowBoardProjection,
} from "../../../shared/rpc.ts";
import { workflowIds } from "../../../workflow/workflowTypes.ts";
import { WorkflowBoard } from "./WorkflowBoardContainer.tsx";

const boardId = workflowIds.board("board-open-project");
const backlogId = workflowIds.stage("stage-open-project-backlog");
const doingId = workflowIds.stage("stage-open-project-doing");
const activeProjection: WorkflowBoardProjection = {
  kind: "workflow_board_projection",
  revision: 1,
  board: {
    boardId,
    repositoryPath: "/Users/name/projects/current-project",
    workflowVersion: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  stages: [
    { stageId: backlogId, boardId, label: "Backlog", position: 0, defaultSkillId: null, configured: false, workflowVersion: 1, updatedAt: 1 },
    { stageId: doingId, boardId, label: "Doing", position: 1, defaultSkillId: null, configured: false, workflowVersion: 1, updatedAt: 1 },
  ],
  edges: [],
  cards: [],
};
const blankProjection: WorkflowBoardProjection = {
  kind: "workflow_board_projection",
  revision: 0,
  board: null,
  stages: [],
  edges: [],
  cards: [],
};

afterEach(() => {
  cleanup();
  resetDesktopViewStore();
  window.localStorage.clear();
});

function createClient(pickerResult: "selected" | "existing" | "cancelled") {
  let pickerCalls = 0;
  const client = {
    getBoard(_boardId?: string, mode?: "active" | "new") {
      return Promise.resolve(createWorkflowBoardEnvelope({
        status: "ok",
        projection: mode === "new" ? blankProjection : activeProjection,
      }));
    },
    getCatalog() {
      return Promise.resolve(createWorkflowCatalogEnvelope({
        status: "ok",
        projection: {
          kind: "workflow_catalog_projection",
          revision: 1,
          catalog: { catalogId: "default", roots: [], entries: [], diagnostics: [] },
        },
      }));
    },
    getWorkspace() {
      return Promise.resolve(createWorkspaceEnvelope({
        status: "ok",
        projection: {
          kind: "workspace_projection",
          revision: 1,
          boards: [{
            boardId,
            repositoryPath: activeProjection.board!.repositoryPath,
            createdAt: 1,
            updatedAt: 1,
            workflowVersion: 1,
          }],
        },
      }));
    },
    pickRepositoryDirectory() {
      pickerCalls += 1;
      return Promise.resolve(createRepositoryDirectoryPickerEnvelope(
        pickerResult === "cancelled"
          ? { status: "cancelled" }
          : pickerResult === "existing"
            ? { status: "selected", path: activeProjection.board!.repositoryPath, boardId }
            : { status: "selected", path: "/Users/name/projects/new-project" },
      ));
    },
    subscribe() { return () => {}; },
    dispose() {},
  } as unknown as DesktopRpcClient;
  return { client, pickerCalls: () => pickerCalls };
}

function renderBoard(client: DesktopRpcClient) {
  const queryClient = createDesktopQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <Toast.Provider placement="bottom end" maxVisibleToasts={3} />
      <WorkflowBoard client={client} />
    </QueryClientProvider>,
  );
}

describe("WorkflowBoard project opening", () => {
  test("opens the selected project's path editor from its action menu", async () => {
    const fake = createClient("cancelled");
    const user = userEvent.setup();
    const view = renderBoard(fake.client);

    await view.findByRole("heading", { name: "current-project" });
    await user.click(view.getByRole("button", { name: "Board actions for Main board" }));
    await user.click(await view.findByRole("menuitem", { name: "Path" }));

    const dialog = await view.findByRole("dialog", { name: "Edit workflow path" });
    expect(within(dialog).getByLabelText("Workflow path canvas")).toBeDefined();
    expect(within(dialog).getByText("Backlog")).toBeDefined();
    expect(within(dialog).getByText("Doing")).toBeDefined();
  });

  test("starts a second board inside the selected project without opening the folder picker", async () => {
    const fake = createClient("cancelled");
    const user = userEvent.setup();
    const view = renderBoard(fake.client);

    await view.findByRole("heading", { name: "current-project" });
    await user.click(view.getByRole("button", { name: "Project actions for current-project" }));
    await user.click(await view.findByRole("menuitem", { name: "Add board" }));

    const dialog = await view.findByRole("dialog", { name: "Add board" });
    await user.click(within(dialog).getByRole("button", { name: "Edit starter workflow" }));
    expect(within(dialog).getByText("/Users/name/projects/current-project")).toBeDefined();
    expect(within(dialog).getByText("This board will be added to the selected project.")).toBeDefined();
    expect(within(dialog).queryByRole("button", { name: "Change folder" })).toBeNull();
    expect(fake.pickerCalls()).toBe(0);

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(view.queryByRole("dialog", { name: "Add board" })).toBeNull();
    expect(view.queryByRole("dialog", { name: "Set up this workflow board" })).toBeNull();
  });

  test("opens the native folder picker first and presents project configuration after selection", async () => {
    const fake = createClient("selected");
    const user = userEvent.setup();
    const view = renderBoard(fake.client);

    await view.findByRole("heading", { name: "current-project" });
    await user.click(view.getByRole("button", { name: "Open project" }));

    expect(fake.pickerCalls()).toBe(1);
    const dialog = await view.findByRole("dialog", { name: "Set up this workflow board" });
    await user.click(within(dialog).getByRole("button", { name: "Edit starter workflow" }));
    expect(within(dialog).getByText("/Users/name/projects/new-project")).toBeDefined();
    expect(view.queryByText("/Users/name/projects/current-project")).toBeNull();
  });

  test("keeps the current board open when folder selection is cancelled", async () => {
    const fake = createClient("cancelled");
    const user = userEvent.setup();
    const view = renderBoard(fake.client);

    await view.findByRole("heading", { name: "current-project" });
    await user.click(view.getByRole("button", { name: "Open project" }));

    expect(fake.pickerCalls()).toBe(1);
    expect(await view.findByText("Folder selection cancelled.")).toBeDefined();
    expect(view.queryByRole("dialog", { name: "Set up this workflow board" })).toBeNull();
    expect(view.getByRole("heading", { name: "current-project" })).toBeDefined();
  });

  test("opens an existing configured project directly", async () => {
    const fake = createClient("existing");
    const user = userEvent.setup();
    const view = renderBoard(fake.client);

    await view.findByRole("heading", { name: "current-project" });
    await user.click(view.getByRole("button", { name: "Open project" }));

    expect(await view.findByText("Project opened.")).toBeDefined();
    expect(view.queryByRole("dialog", { name: "Set up this workflow board" })).toBeNull();
  });
});
