import { afterEach, describe, expect, test } from "bun:test";
import "../../settings/testDom.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toast } from "@heroui/react";
import { act, cleanup, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DesktopRpcClient } from "../../client.ts";
import {
  createDesktopQueryClient,
  useDesktopHostInvalidation,
} from "../../query/desktopQueries.ts";
import { resetDesktopViewStore } from "../../state/desktopViewStore.ts";
import {
  createCardInspectorEnvelope,
  createEmptySupervisionProjection,
  createRepositoryDirectoryPickerEnvelope,
  createSettingsEnvelope,
  createSupervisionEnvelope,
  createWorkflowBoardEnvelope,
  createWorkflowCatalogEnvelope,
  createWorkspaceEnvelope,
  type HostMessageEnvelope,
  type SupervisionProjection,
  type WorkflowBoardProjection,
} from "../../../shared/rpc.ts";
import {
  workflowIds,
  type CardProjection,
} from "../../../workflow/workflowTypes.ts";
import { WorkflowBoard } from "./WorkflowBoardContainer.tsx";
import { NARROW_SHELL_MEDIA_QUERY } from "./useResponsiveShellMode.ts";
import { inspectorProjection } from "../inspector/testSupport.ts";
import { useDesktopViewStore } from "../../state/desktopViewStore.ts";

const boardId = workflowIds.board("board-open-project");

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

function installShellMediaQuery(initialNarrow: boolean) {
  let narrow = initialNarrow;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const shellQuery = {
    get matches() {
      return narrow;
    },
    media: NARROW_SHELL_MEDIA_QUERY,
    onchange: null,
    addListener(listener: (event: MediaQueryListEvent) => void) {
      listeners.add(listener);
    },
    removeListener(listener: (event: MediaQueryListEvent) => void) {
      listeners.delete(listener);
    },
    addEventListener(_type: string, listener: (event: MediaQueryListEvent) => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: (event: MediaQueryListEvent) => void) {
      listeners.delete(listener);
    },
    dispatchEvent() {
      return true;
    },
  } as MediaQueryList;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => query === NARROW_SHELL_MEDIA_QUERY
      ? shellQuery
      : ({
          ...shellQuery,
          matches: false,
          media: query,
        } as MediaQueryList),
  });
  return {
    setNarrow(nextNarrow: boolean) {
      narrow = nextNarrow;
      act(() => {
        const event = { matches: narrow, media: NARROW_SHELL_MEDIA_QUERY } as MediaQueryListEvent;
        for (const listener of listeners) listener(event);
      });
    },
  };
}
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
const boardBId = workflowIds.board("board-workbench-beta");
const boardBStageId = workflowIds.stage("stage-workbench-beta");
const alphaCard: CardProjection = {
  cardId: workflowIds.card("card-workbench-alpha"),
  boardId,
  stageId: backlogId,
  title: "Alpha restoration card",
  description: "Preserve the original board position",
  provider: "codex",
  model: "gpt-5",
  effort: "high",
  skillOverrideId: null,
  runnable: true,
  executionStatus: "running",
  version: 1,
  createdAt: 1,
  updatedAt: 2,
};
const betaCard: CardProjection = {
  ...alphaCard,
  cardId: workflowIds.card("card-workbench-beta"),
  boardId: boardBId,
  stageId: boardBStageId,
  title: "Beta cross-project card",
};
const workbenchProjectionA: WorkflowBoardProjection = {
  ...activeProjection,
  cards: [alphaCard],
};
const workbenchProjectionB: WorkflowBoardProjection = {
  kind: "workflow_board_projection",
  revision: 2,
  board: {
    boardId: boardBId,
    repositoryPath: "/Users/name/projects/beta-project",
    workflowVersion: 1,
    createdAt: 2,
    updatedAt: 2,
  },
  stages: [{
    stageId: boardBStageId,
    boardId: boardBId,
    label: "Doing",
    position: 0,
    defaultSkillId: null,
    configured: false,
    workflowVersion: 1,
    updatedAt: 2,
  }],
  edges: [],
  cards: [betaCard],
};

function betaSupervisionProjection(
  status: "needs_attention" | "ready_for_review" = "ready_for_review",
  revision = 2,
): SupervisionProjection {
  const empty = createEmptySupervisionProjection(revision);
  const item = {
    boardId: boardBId,
    cardId: betaCard.cardId,
    cardVersion: betaCard.version,
    attemptId: null,
    generation: null,
    status,
    priority: status === "needs_attention" ? 0 as const : 1 as const,
    evidenceAvailability: status === "ready_for_review"
      ? {
          status: "unavailable" as const,
          error: {
            code: "evidence_missing" as const,
            recoveryHint: "retry_evidence_capture" as const,
          },
        }
      : { status: "not_applicable" as const },
    actionableAt: revision,
    updatedAt: revision,
  };
  const groups = empty.groups.map((group) => ({
    ...group,
    items: group.status === status ? [item] : [],
  }));
  return {
    ...empty,
    revision,
    generatedAt: revision,
    groups,
    counts: {
      needs_attention: status === "needs_attention" ? 1 : 0,
      ready_for_review: status === "ready_for_review" ? 1 : 0,
      failed: 0,
      running: 0,
      settled: 0,
    },
  };
}

afterEach(() => {
  cleanup();
  resetDesktopViewStore();
  window.localStorage.clear();
  if (originalMatchMedia === undefined) {
    delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia;
  } else {
    Object.defineProperty(window, "matchMedia", originalMatchMedia);
  }
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
  function BoardHarness() {
    useDesktopHostInvalidation(client);
    return <WorkflowBoard client={client} />;
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <Toast.Provider placement="bottom end" maxVisibleToasts={3} />
      <BoardHarness />
    </QueryClientProvider>,
  );
}

function inspectorForCard(card: CardProjection, revision: number) {
  const projection = inspectorProjection({ revision });
  return {
    ...projection,
    cardId: card.cardId,
    card,
    attempts: projection.attempts.map((attempt) => ({
      ...attempt,
      boardId: card.boardId,
      cardId: card.cardId,
      context: {
        ...attempt.context,
        card: {
          ...attempt.context.card,
          cardId: card.cardId,
          title: card.title,
          description: card.description,
          version: card.version,
        },
        workflow: {
          ...attempt.context.workflow,
          boardId: card.boardId,
        },
      },
    })),
  };
}

function createWorkbenchClient() {
  const subscribers = new Set<(message: HostMessageEnvelope) => void>();
  let inspectorRequests = 0;
  let supervisionRequests = 0;
  let boardRequests = 0;
  const requestedBoardIds: Array<string | undefined> = [];
  let supervisionProjection = betaSupervisionProjection();
  let betaCardAvailable = true;
  const client = {
    async getDesktopSnapshot() { throw new Error("not used"); },
    async getBoard(requestedBoardId?: string) {
      boardRequests += 1;
      requestedBoardIds.push(requestedBoardId);
      return createWorkflowBoardEnvelope({
        status: "ok",
        projection: requestedBoardId === boardBId
          ? {
              ...workbenchProjectionB,
              cards: betaCardAvailable ? workbenchProjectionB.cards : [],
            }
          : workbenchProjectionA,
      });
    },
    async getSupervision() {
      supervisionRequests += 1;
      return createSupervisionEnvelope({
        status: "ok",
        projection: supervisionProjection,
      });
    },
    async getWorkspace() {
      return createWorkspaceEnvelope({
        status: "ok",
        projection: {
          kind: "workspace_projection",
          revision: 2,
          boards: [
            {
              boardId,
              repositoryPath: workbenchProjectionA.board!.repositoryPath,
              createdAt: 1,
              updatedAt: 2,
              workflowVersion: 1,
            },
            {
              boardId: boardBId,
              repositoryPath: workbenchProjectionB.board!.repositoryPath,
              createdAt: 2,
              updatedAt: 2,
              workflowVersion: 1,
            },
          ],
        },
      });
    },
    async getCatalog() {
      return createWorkflowCatalogEnvelope({
        status: "ok",
        projection: {
          kind: "workflow_catalog_projection",
          revision: 1,
          catalog: { catalogId: "default", roots: [], entries: [], diagnostics: [] },
        },
      });
    },
    async getSettings() {
      return createSettingsEnvelope({
        status: "unavailable",
        unavailable: { resource: "desktop_settings", reason: "not_ready" },
      });
    },
    async getCardInspector(cardId: string) {
      inspectorRequests += 1;
      const card = cardId === betaCard.cardId ? betaCard : alphaCard;
      return createCardInspectorEnvelope({
        status: "ok",
        projection: inspectorForCard(card, 10 + inspectorRequests),
      });
    },
    async getReviewManifest() { throw new Error("not used"); },
    async getReviewDiffChunk() { throw new Error("not used"); },
    async executeWorkflowCommand() { throw new Error("not used"); },
    async submitCardPrompt() { throw new Error("not used"); },
    async answerAttention() { throw new Error("not used"); },
    async updatePreferences() { throw new Error("not used"); },
    async updateProfileDefaults() { throw new Error("not used"); },
    async updateCatalogRoots() { throw new Error("not used"); },
    async setExecutionLimit() { throw new Error("not used"); },
    subscribe(listener: (message: HostMessageEnvelope) => void) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    dispose() {},
  } as unknown as DesktopRpcClient;
  return {
    client,
    emit(message: HostMessageEnvelope) {
      subscribers.forEach((subscriber) => subscriber(message));
    },
    inspectorRequests: () => inspectorRequests,
    supervisionRequests: () => supervisionRequests,
    boardRequests: () => boardRequests,
    requestedBoardIds: () => [...requestedBoardIds],
    setSupervision(next: SupervisionProjection) {
      supervisionProjection = next;
    },
    removeBetaCard() {
      betaCardAvailable = false;
      supervisionProjection = createEmptySupervisionProjection(supervisionProjection.revision + 1);
    },
  };
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

describe("WorkflowBoard workbench restoration", () => {
  test("keeps the board mounted and a valid workbench open across revision refresh", async () => {
    const fake = createWorkbenchClient();
    const user = userEvent.setup();
    const view = renderBoard(fake.client);

    const boardHeading = await view.findByRole("heading", { name: "Workflow board" });
    const navigation = view.getByRole("complementary", { name: "Repository navigation" });
    const board = view.getByRole("main", { name: "Kanban board" });
    await user.click(view.getByRole("button", { name: "Open Alpha restoration card" }));
    const workbench = await view.findByRole("complementary", { name: "Alpha restoration card" });
    expect(navigation.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(board.compareDocumentPosition(workbench) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(within(workbench).getByRole("button", { name: /Settings/ })).toBeDefined();
    expect(view.getByRole("heading", { name: "Workflow board" })).toBe(boardHeading);

    await act(async () => {
      fake.emit({ kind: "projection_committed", messageId: "refresh", revision: 12 });
      await Bun.sleep(0);
    });
    await waitFor(() => expect(fake.inspectorRequests()).toBe(2));
    expect(view.getByRole("complementary", { name: "Alpha restoration card" })).toBeDefined();
    expect(useDesktopViewStore.getState().selectedCard?.cardId).toBe(alphaCard.cardId);
  });

  test("restores the originating scroll anchor, selected card, and keyboard focus", async () => {
    const fake = createWorkbenchClient();
    const user = userEvent.setup();
    const view = renderBoard(fake.client);

    await view.findByRole("heading", { name: "Workflow board" });
    const stageList = view.getByRole("list", { name: "Ordered workflow stages" });
    stageList.scrollLeft = 288;
    stageList.scrollTop = 24;
    const openButton = view.getByRole("button", { name: "Open Alpha restoration card" });
    openButton.focus();
    await user.click(openButton);
    const workbench = await view.findByRole("complementary", { name: "Alpha restoration card" });

    stageList.scrollLeft = 0;
    stageList.scrollTop = 0;
    await user.click(within(workbench).getByRole("button", { name: "Close workbench" }));

    await waitFor(() => expect(view.queryByRole("complementary", { name: "Alpha restoration card" })).toBeNull());
    expect(stageList.scrollLeft).toBe(288);
    expect(stageList.scrollTop).toBe(24);
    expect(document.activeElement).toBe(openButton);
    expect(useDesktopViewStore.getState().selectedCard?.cardId).toBe(alphaCard.cardId);
  });

  test("opens a cross-project card while retaining and restoring the prior board context", async () => {
    const fake = createWorkbenchClient();
    const user = userEvent.setup();
    const view = renderBoard(fake.client);

    await view.findByRole("heading", { name: "current-project" });
    act(() => {
      useDesktopViewStore.getState().openWorkbench({
        target: {
          repositoryKey: workbenchProjectionB.board!.repositoryPath,
          boardId: boardBId,
          cardId: betaCard.cardId,
        },
        mode: "desktop",
        origin: {
          repositoryKey: workbenchProjectionA.board!.repositoryPath,
          boardId,
          boardMode: "active",
          anchor: {
            stageId: backlogId,
            cardId: alphaCard.cardId,
            scrollLeft: 144,
            scrollTop: 0,
          },
          focusTargetId: `card-open-${alphaCard.cardId}`,
        },
      });
    });

    const workbench = await view.findByRole("complementary", { name: "Beta cross-project card" });
    expect(useDesktopViewStore.getState().workbenchOrigin?.boardId).toBe(boardId);
    await user.click(within(workbench).getByRole("button", { name: "Close workbench" }));

    expect(await view.findByRole("heading", { name: "current-project" })).toBeDefined();
    await waitFor(() => expect(useDesktopViewStore.getState().activeBoardId).toBe(boardId));
    expect(useDesktopViewStore.getState().selectedCard?.cardId).toBe(alphaCard.cardId);
  });

  test("opens a cross-project Work Inbox item and records the current board anchor", async () => {
    const fake = createWorkbenchClient();
    const user = userEvent.setup();
    const view = renderBoard(fake.client);

    await view.findByRole("heading", { name: "current-project" });
    const stageList = view.getByRole("list", { name: "Ordered workflow stages" });
    stageList.scrollLeft = 216;
    await user.click(await view.findByRole("button", {
      name: /open card card-workbench-beta.*beta-project/i,
    }));

    expect(await view.findByRole("complementary", { name: "Beta cross-project card" })).toBeDefined();
    expect(useDesktopViewStore.getState().workbenchOrigin).toMatchObject({
      boardId,
      repositoryKey: workbenchProjectionA.board!.repositoryPath,
      anchor: { scrollLeft: 216 },
    });
    expect(useDesktopViewStore.getState().selectedCard).toMatchObject({
      boardId: boardBId,
      cardId: betaCard.cardId,
    });
  });

  test("refetches supervision once and preserves a valid narrow workbench across refresh", async () => {
    const fake = createWorkbenchClient();
    const media = installShellMediaQuery(false);
    const user = userEvent.setup();
    const view = renderBoard(fake.client);

    await user.click(await view.findByRole("button", {
      name: /open card card-workbench-beta/i,
    }));
    expect(await view.findByRole("complementary", { name: "Beta cross-project card" })).toBeDefined();
    await user.type(view.getByLabelText("Message"), "Resize-safe draft");
    act(() => {
      useDesktopViewStore.getState().selectReview({
        evidenceId: "resize-evidence",
        attemptId: useDesktopViewStore.getState().selectedAttemptId!,
        fileId: "resize-file",
      });
    });
    const beforeResize = useDesktopViewStore.getState();
    media.setNarrow(true);
    act(() => {
      fake.setSupervision(betaSupervisionProjection("needs_attention", 3));
    });
    const beforeRefresh = fake.supervisionRequests();
    await act(async () => {
      fake.emit({ kind: "projection_committed", messageId: "inbox-refresh", revision: 3 });
      await Bun.sleep(0);
    });

    await waitFor(() => expect(fake.supervisionRequests()).toBe(beforeRefresh + 1));
    const workbench = view.getByRole("complementary", { name: "Beta cross-project card" });
    expect(within(workbench).getByRole("button", { name: "Back to board" })).toBeDefined();
    expect(view.queryByRole("main", { name: "Kanban board" })).toBeNull();
    expect(useDesktopViewStore.getState().selectedCard?.cardId).toBe(betaCard.cardId);
    expect(useDesktopViewStore.getState().workbenchMode).toBe("narrow");
    expect(useDesktopViewStore.getState().activeBoardId).toBe(beforeResize.activeBoardId);
    expect(useDesktopViewStore.getState().selectedAttemptId).toBe(beforeResize.selectedAttemptId);
    expect(useDesktopViewStore.getState().selectedReview).toEqual(beforeResize.selectedReview);
    expect(useDesktopViewStore.getState().drafts).toEqual(beforeResize.drafts);
    media.setNarrow(false);
    await waitFor(() => expect(useDesktopViewStore.getState().workbenchMode).toBe("desktop"));
    expect(view.getByLabelText("1 Attention item").textContent).toBe("1");
    expect(view.getByLabelText("0 Ready for review items").textContent).toBe("0");
    expect(view.getByRole("main", { name: "Kanban board" })).toBeDefined();
    expect(view.getByRole("complementary", { name: "Beta cross-project card" })).toBeDefined();
    await Bun.sleep(0);
    expect(fake.supervisionRequests()).toBe(beforeRefresh + 1);
  });

  test("loads one supervision projection without per-board reads", async () => {
    const fake = createWorkbenchClient();
    const view = renderBoard(fake.client);

    expect(await view.findByRole("button", {
      name: /open card card-workbench-beta/i,
    })).toBeDefined();
    expect(fake.supervisionRequests()).toBe(1);
    expect(fake.boardRequests()).toBe(2);
    expect(fake.requestedBoardIds()).toEqual([undefined, boardId]);
  });

  test("recovers to the originating board and announces when the selected inbox card disappears", async () => {
    const fake = createWorkbenchClient();
    const user = userEvent.setup();
    const view = renderBoard(fake.client);

    await user.click(await view.findByRole("button", {
      name: /open card card-workbench-beta/i,
    }));
    expect(await view.findByRole("complementary", { name: "Beta cross-project card" })).toBeDefined();
    await act(async () => {
      fake.removeBetaCard();
      fake.emit({ kind: "projection_committed", messageId: "card-removed", revision: 4 });
      await Bun.sleep(0);
    });

    await waitFor(() => expect(useDesktopViewStore.getState().workbenchMode).toBe("closed"));
    expect(useDesktopViewStore.getState().activeBoardId).toBe(boardId);
    expect(useDesktopViewStore.getState().navigationAnnouncement).toContain(
      "selected card is no longer available",
    );
    expect(await view.findByRole("heading", { name: "current-project" })).toBeDefined();
  });
});
