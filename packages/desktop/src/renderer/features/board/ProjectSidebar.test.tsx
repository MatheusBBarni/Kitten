import { afterEach, describe, expect, test } from "bun:test";
import "../../settings/testDom.ts";
import { cleanup, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { workflowIds } from "../../../workflow/workflowTypes.ts";
import {
  createEmptySupervisionProjection,
  type ReviewEvidenceAvailability,
  type SupervisionItem,
  type SupervisionProjection,
  type SupervisionStatus,
} from "../../../shared/rpc.ts";
import { resetDesktopViewStore } from "../../state/desktopViewStore.ts";
import { ProjectSidebar } from "./ProjectSidebar.tsx";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetDesktopViewStore();
});

const boardId = workflowIds.board("board-project-sidebar");
const secondBoardId = workflowIds.board("board-project-sidebar-second");
const betaBoardId = workflowIds.board("board-project-sidebar-beta");
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

const priorityByStatus = {
  needs_attention: 0,
  ready_for_review: 1,
  failed: 2,
  running: 3,
  settled: 4,
} as const;

function supervisionItem(
  status: SupervisionStatus,
  itemBoardId: typeof boardId,
  cardId: string,
  actionableAt: number,
  evidenceAvailability: ReviewEvidenceAvailability = { status: "not_applicable" },
): SupervisionItem {
  return {
    boardId: itemBoardId,
    cardId: workflowIds.card(cardId),
    cardVersion: 1,
    attemptId: null,
    generation: null,
    status,
    priority: priorityByStatus[status],
    evidenceAvailability,
    actionableAt,
    updatedAt: actionableAt,
  };
}

function supervisionProjection(
  items: readonly SupervisionItem[],
): SupervisionProjection {
  const empty = createEmptySupervisionProjection(3);
  const groups = empty.groups.map((group) => ({
    ...group,
    items: items.filter(({ status }) => status === group.status),
  }));
  return {
    ...empty,
    revision: 3,
    generatedAt: 3,
    groups,
    counts: {
      needs_attention: groups[0]!.items.length,
      ready_for_review: groups[1]!.items.length,
      failed: groups[2]!.items.length,
      running: groups[3]!.items.length,
      settled: groups[4]!.items.length,
    },
  };
}

const multiProjectWorkspace = {
  ...workspace,
  boards: [
    ...workspace.boards,
    {
      boardId: betaBoardId,
      repositoryPath: "/Users/name/projects/beta-project",
      createdAt: 3,
      updatedAt: 3,
      workflowVersion: 1,
    },
  ],
};

describe("ProjectSidebar", () => {
  test("collapses and expands a project's board tree without hiding the project", async () => {
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

    const toggle = view.getByRole("button", { name: /kitten.*2 boards/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(view.getByRole("button", { name: "Main board" })).toBeDefined();
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(view.getByText("kitten")).toBeDefined();
    expect(view.queryByRole("button", { name: "Main board" })).toBeNull();
    await user.click(toggle);
    expect(view.getByRole("button", { name: "Main board" })).toBeDefined();
  });

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

  test("renders authoritative groups, counts, and item order without reprioritizing in the renderer", () => {
    const items = [
      supervisionItem("needs_attention", boardId, "card-attention-first", 50),
      supervisionItem("needs_attention", secondBoardId, "card-attention-second", 40),
      supervisionItem("ready_for_review", betaBoardId, "card-review", 30, {
        status: "available",
        evidenceId: "evidence-review",
        evidenceDigest: "digest-review",
      }),
      supervisionItem("failed", boardId, "card-failed", 20),
      supervisionItem("running", boardId, "card-running", 10),
      supervisionItem("settled", boardId, "card-settled", 5),
    ];
    const view = render(
      <ProjectSidebar
        workspace={multiProjectWorkspace}
        activeBoardId={boardId}
        busy={false}
        workInbox={{ status: "ready", projection: supervisionProjection(items) }}
        onOpenProject={() => {}}
        onAddBoard={() => {}}
        onSelectBoard={() => {}}
        onEditPath={() => {}}
      />,
    );

    const inbox = view.getByRole("navigation", { name: "Work Inbox" });
    expect(within(inbox).getAllByRole("heading").map(({ textContent }) => textContent)).toEqual([
      "Attention",
      "Ready for review",
      "Failed",
      "Running",
      "Settled",
    ]);
    expect(within(inbox).getByLabelText("2 Attention items").textContent).toBe("2");
    expect(within(inbox).getByLabelText("1 Ready for review item").textContent).toBe("1");
    expect(within(inbox).getAllByRole("button").slice(0, 2).map((button) => button.id)).toEqual([
      "work-inbox-card-board-project-sidebar-card-attention-first",
      "work-inbox-card-board-project-sidebar-second-card-attention-second",
    ]);
    expect(within(inbox).getByText(/Review evidence available/)).toBeDefined();
  });

  test("uses one search across repository, board, and card labels while retaining status groups", async () => {
    window.localStorage.setItem("kitten:project-sidebar-preferences:v1", JSON.stringify({
      [betaBoardId]: { name: "Release board" },
    }));
    const user = userEvent.setup();
    const projection = supervisionProjection([
      supervisionItem("needs_attention", boardId, "card-current-project", 20),
      supervisionItem("ready_for_review", betaBoardId, "card-fix-release", 10),
    ]);
    const view = render(
      <ProjectSidebar
        workspace={multiProjectWorkspace}
        activeBoardId={boardId}
        busy={false}
        workInbox={{ status: "ready", projection }}
        onOpenProject={() => {}}
        onAddBoard={() => {}}
        onSelectBoard={() => {}}
        onEditPath={() => {}}
      />,
    );
    const search = view.getByRole("searchbox", { name: "Search projects, boards, and cards" });

    await user.type(search, "beta-project");
    expect(view.getByRole("button", { name: /card-fix-release/i })).toBeDefined();
    expect(view.queryByRole("button", { name: /card-current-project/i })).toBeNull();
    expect(view.getByRole("heading", { name: "Ready for review" })).toBeDefined();

    await user.clear(search);
    await user.type(search, "Release board");
    expect(view.getByRole("button", { name: /card-fix-release/i })).toBeDefined();
    expect(view.queryByRole("button", { name: /card-current-project/i })).toBeNull();

    await user.clear(search);
    await user.type(search, "card-current-project");
    expect(view.getByRole("button", { name: /card-current-project/i })).toBeDefined();
    expect(view.queryByRole("button", { name: /card-fix-release/i })).toBeNull();
  });

  test("distinguishes loading, typed unavailable, empty workspace, and filtered-empty guidance", async () => {
    const user = userEvent.setup();
    const props = {
      activeBoardId: boardId,
      busy: false,
      onOpenProject: () => {},
      onAddBoard: () => {},
      onSelectBoard: () => {},
      onEditPath: () => {},
    };
    const view = render(
      <ProjectSidebar
        {...props}
        workspace={workspace}
        workInbox={{ status: "loading" }}
      />,
    );
    expect(view.getByLabelText("Loading Work Inbox").getAttribute("aria-busy")).toBe("true");

    view.rerender(
      <ProjectSidebar
        {...props}
        workspace={workspace}
        workInbox={{ status: "unavailable", reason: "projection_rejected" }}
      />,
    );
    expect(view.getByRole("alert").textContent).toContain("host rejected the Work Inbox projection");

    view.rerender(
      <ProjectSidebar
        {...props}
        workspace={{ ...workspace, boards: [] }}
        workInbox={{ status: "ready", projection: createEmptySupervisionProjection() }}
      />,
    );
    expect(view.getByText("Open a repository to create work for the inbox.")).toBeDefined();

    view.rerender(
      <ProjectSidebar
        {...props}
        workspace={workspace}
        workInbox={{
          status: "ready",
          projection: supervisionProjection([
            supervisionItem("running", boardId, "card-searchable", 10),
          ]),
        }}
      />,
    );
    await user.type(view.getByRole("searchbox"), "no-match");
    expect(view.getByRole("status").textContent).toContain("No Work Inbox items match this search");
  });

  test("keeps evidence-unavailable items actionable and keyboard reachable with current state", async () => {
    const user = userEvent.setup();
    const selections: string[] = [];
    const unavailableItem = supervisionItem("ready_for_review", boardId, "card-no-evidence", 10, {
      status: "unavailable",
      error: { code: "evidence_missing", recoveryHint: "retry_evidence_capture" },
    });
    const view = render(
      <ProjectSidebar
        workspace={workspace}
        activeBoardId={boardId}
        busy={false}
        workInbox={{ status: "ready", projection: supervisionProjection([unavailableItem]) }}
        selectedInboxItem={{
          boardId: unavailableItem.boardId,
          cardId: unavailableItem.cardId,
        }}
        onSelectInboxItem={({ item }) => selections.push(item.cardId)}
        onOpenProject={() => {}}
        onAddBoard={() => {}}
        onSelectBoard={() => {}}
        onEditPath={() => {}}
      />,
    );
    const item = view.getByRole("button", {
      name: /card-no-evidence.*status ready for review.*review evidence unavailable/i,
    });
    expect(item.getAttribute("aria-current")).toBe("true");
    expect(item.hasAttribute("disabled")).toBe(false);

    for (let index = 0; index < 6 && document.activeElement !== item; index += 1) {
      await user.tab();
    }
    expect(document.activeElement).toBe(item);
    await user.keyboard("{Enter}");
    expect(selections).toEqual([unavailableItem.cardId]);
  });

  test("keeps an unmatched host item visible but unavailable until repository details load", () => {
    const unmatchedItem = supervisionItem(
      "needs_attention",
      workflowIds.board("board-not-yet-loaded"),
      "card-not-yet-loaded",
      10,
    );
    const view = render(
      <ProjectSidebar
        workspace={workspace}
        activeBoardId={boardId}
        busy={false}
        workInbox={{ status: "ready", projection: supervisionProjection([unmatchedItem]) }}
        onOpenProject={() => {}}
        onAddBoard={() => {}}
        onSelectBoard={() => {}}
        onEditPath={() => {}}
      />,
    );

    const item = view.getByRole("button", { name: /card-not-yet-loaded/i });
    expect(item.hasAttribute("disabled")).toBe(true);
    expect(item.getAttribute("aria-label")).toContain(
      "Navigation unavailable until repository details load",
    );
    expect(view.getByText(/Navigation unavailable$/)).toBeDefined();
  });

  test("preserves pin and archive preferences and scopes hidden projects out of the inbox", async () => {
    const user = userEvent.setup();
    const projection = supervisionProjection([
      supervisionItem("running", boardId, "card-preference-scope", 10),
    ]);
    const view = render(
      <ProjectSidebar
        workspace={workspace}
        activeBoardId={boardId}
        busy={false}
        workInbox={{ status: "ready", projection }}
        onOpenProject={() => {}}
        onAddBoard={() => {}}
        onSelectBoard={() => {}}
        onEditPath={() => {}}
      />,
    );
    const inboxItem = () => view.queryByRole("button", { name: /card-preference-scope/i });
    const openActions = async () => {
      await user.click(view.getByRole("button", { name: "Project actions for kitten" }));
    };

    await openActions();
    await user.click(await view.findByRole("menuitem", { name: "Pin" }));
    expect(inboxItem()).not.toBeNull();
    expect(view.getByRole("heading", { name: "Pinned" })).toBeDefined();

    await openActions();
    await user.click(await view.findByRole("menuitem", { name: "Archive" }));
    expect(inboxItem()).not.toBeNull();
    expect(view.getByRole("heading", { name: "Archived" })).toBeDefined();

    await openActions();
    await user.click(await view.findByRole("menuitem", { name: "Delete from sidebar" }));
    await user.click(view.getByRole("button", { name: "Delete from sidebar" }));
    expect(inboxItem()).toBeNull();
    expect(view.getByRole("status").textContent).toContain("hidden by sidebar preferences");
    expect(view.getByLabelText("1 supervised card").textContent).toBe("1");
  });
});
