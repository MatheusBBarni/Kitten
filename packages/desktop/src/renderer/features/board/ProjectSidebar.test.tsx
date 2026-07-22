import { afterEach, describe, expect, test } from "bun:test";
import "../../settings/testDom.ts";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { workflowIds } from "../../../workflow/workflowTypes.ts";
import { ProjectSidebar } from "./ProjectSidebar.tsx";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const boardId = workflowIds.board("board-project-sidebar");
const workspace = {
  kind: "workspace_projection" as const,
  revision: 1,
  boards: [{
    boardId,
    repositoryPath: "/Users/name/projects/kitten",
    updatedAt: 1,
    workflowVersion: 1,
  }],
};

describe("ProjectSidebar", () => {
  test("offers rename, pin, archive, and guarded sidebar deletion for each project", async () => {
    const user = userEvent.setup();
    const view = render(
      <ProjectSidebar
        workspace={workspace}
        activeBoardId={boardId}
        busy={false}
        onOpenProject={() => {}}
        onSelectBoard={() => {}}
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
    expect(view.getByText(/repository and its durable workflow history stay on disk/i)).toBeDefined();
    await user.click(view.getByRole("button", { name: "Delete from sidebar" }));
    expect(view.queryByRole("button", { name: "Project actions for kitten" })).toBeNull();
    expect(view.getByText("No projects match this search.")).toBeDefined();
  });
});
