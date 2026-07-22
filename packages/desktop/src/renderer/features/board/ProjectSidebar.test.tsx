import { afterEach, describe, expect, test } from "bun:test";
import "../../settings/testDom.ts";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { workflowIds } from "../../../workflow/workflowTypes.ts";
import { ProjectSidebar } from "./ProjectSidebar.tsx";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const boardId = workflowIds.board("board-project-sidebar");
const secondBoardId = workflowIds.board("board-project-sidebar-second");
const workspace = {
  kind: "workspace_projection" as const,
  revision: 1,
  boards: [
    {
      boardId: secondBoardId,
      repositoryPath: "/Users/name/projects/kitten",
      createdAt: 2,
      updatedAt: 2,
      workflowVersion: 1,
    },
    {
      boardId,
      repositoryPath: "/Users/name/projects/kitten",
      createdAt: 1,
      updatedAt: 1,
      workflowVersion: 1,
    },
  ],
};

describe("ProjectSidebar", () => {
  test("groups multiple boards under one project and exposes board actions", async () => {
    const user = userEvent.setup();
    const pathRequests: string[] = [];
    const boardSelections: string[] = [];
    const boardCreations: string[] = [];
    const view = render(
      <ProjectSidebar
        workspace={workspace}
        activeBoardId={boardId}
        busy={false}
        onOpenProject={() => {}}
        onAddBoard={(repositoryPath) => boardCreations.push(repositoryPath)}
        onSelectBoard={(requestedBoardId) => boardSelections.push(requestedBoardId)}
        onEditPath={(requestedBoardId) => pathRequests.push(requestedBoardId)}
      />,
    );

    expect(view.queryByText("/Users/name/projects/kitten")).toBeNull();
    expect(view.queryByText("Workflow board")).toBeNull();
    expect(view.queryByText("Settings")).toBeNull();
    expect(view.container.querySelector('img[src="./kitten-icon.png"]')).not.toBeNull();
    expect(view.getByText("2 boards")).toBeDefined();
    expect(view.getByRole("button", { name: "Main board" })).toBeDefined();
    expect(view.getByRole("button", { name: "Board 2" })).toBeDefined();
    const selectedBoard = view.getByRole("button", { name: "Main board" }).closest("li");
    expect(selectedBoard?.getAttribute("data-selected")).toBe("true");
    expect(selectedBoard?.className).toContain("data-[selected=true]:bg-[var(--accent-soft)]");

    await user.click(view.getByRole("button", { name: "Board 2" }));
    expect(boardSelections).toEqual([secondBoardId]);

    await user.click(view.getByRole("button", { name: "Project actions for kitten" }));
    await user.click(await view.findByRole("menuitem", { name: "Add board" }));
    expect(boardCreations).toEqual(["/Users/name/projects/kitten"]);

    await user.click(view.getByRole("button", { name: "Board actions for Main board" }));
    await user.click(await view.findByRole("menuitem", { name: "Path" }));
    expect(pathRequests).toEqual([boardId]);

    await user.click(view.getByRole("button", { name: "Board actions for Main board" }));
    await user.click(await view.findByRole("menuitem", { name: "Rename" }));
    expect(await view.findByRole("dialog", { name: "Rename board" })).toBeDefined();
    expect((view.getByLabelText("Board name") as HTMLInputElement).value).toBe("Main board");
    await user.click(view.getByRole("button", { name: "Cancel" }));

    await user.click(view.getByRole("button", { name: "Board actions for Main board" }));
    await user.click(await view.findByRole("menuitem", { name: "Archive" }));
    expect(view.getByRole("button", { name: "Main board" }).closest("li")?.getAttribute("data-archived")).toBe("true");
  });

  test("offers project-level rename, pin, archive, and guarded sidebar deletion", async () => {
    const user = userEvent.setup();
    const view = render(
      <ProjectSidebar
        workspace={workspace}
        activeBoardId={boardId}
        busy={false}
        onOpenProject={() => {}}
        onAddBoard={() => {}}
        onSelectBoard={() => {}}
        onEditPath={() => {}}
      />,
    );

    const openActions = async () => {
      await user.click(view.getByRole("button", { name: "Project actions for kitten" }));
    };

    await openActions();
    await user.click(await view.findByRole("menuitem", { name: "Rename" }));
    expect(await view.findByRole("dialog", { name: "Rename project" })).toBeDefined();
    expect((view.getByLabelText("Project name") as HTMLInputElement).value).toBe("kitten");
    await user.click(view.getByRole("button", { name: "Cancel" }));

    await openActions();
    await user.click(await view.findByRole("menuitem", { name: "Pin" }));
    expect(view.getByRole("heading", { name: "Pinned" })).toBeDefined();

    await openActions();
    await user.click(await view.findByRole("menuitem", { name: "Archive" }));
    expect(view.getByRole("heading", { name: "Archived" })).toBeDefined();

    await openActions();
    await user.click(await view.findByRole("menuitem", { name: "Delete from sidebar" }));
    expect(await view.findByRole("alertdialog", { name: "Delete this project from the sidebar?" })).toBeDefined();
    expect(view.getByText(/repository and all its durable board histories stay on disk/i)).toBeDefined();
    await user.click(view.getByRole("button", { name: "Delete from sidebar" }));
    expect(view.queryByRole("button", { name: "Project actions for kitten" })).toBeNull();
    expect(view.getByText("No projects or boards match this search.")).toBeDefined();
  });
});
