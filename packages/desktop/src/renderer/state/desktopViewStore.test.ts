import { afterEach, describe, expect, test } from "bun:test";
import "../settings/testDom.ts";
import {
  createDraftKey,
  resetDesktopViewStore,
  useDesktopViewStore,
  type BoardReference,
  type DraftNamespace,
  type OpenWorkbenchInput,
} from "./desktopViewStore.ts";

const boards: readonly BoardReference[] = [
  { repositoryKey: "/projects/alpha", boardId: "board-a" },
  { repositoryKey: "/projects/beta", boardId: "board-b" },
];

function workbenchInput(overrides: Partial<OpenWorkbenchInput> = {}): OpenWorkbenchInput {
  return {
    target: {
      repositoryKey: "/projects/beta",
      boardId: "board-b",
      cardId: "card-b",
    },
    attemptId: "attempt-b-2",
    mode: "desktop",
    origin: {
      repositoryKey: "/projects/alpha",
      boardId: "board-a",
      boardMode: "active",
      anchor: {
        stageId: "stage-a-doing",
        cardId: "card-a",
        scrollLeft: 320,
        scrollTop: 48,
      },
      focusTargetId: "card-open-card-a",
    },
    ...overrides,
  };
}

afterEach(() => {
  resetDesktopViewStore();
  window.localStorage.clear();
});

describe("desktop workbench view state", () => {
  test("keeps renderer chrome, project setup, and workbench presentation transitions local", () => {
    const store = useDesktopViewStore.getState();
    store.setRoute("settings");
    store.setInitialBoard("board-initial");
    store.toggleProjectExpanded("project:alpha");
    store.toggleProjectExpanded("project:alpha");
    store.beginProjectSetup();
    store.setInitialBoard("board-ignored");
    store.cancelProjectSetup();
    store.finishProjectSetup("board-created");
    store.selectBoard("board-a");
    store.setWorkbenchMode("narrow");

    expect(useDesktopViewStore.getState()).toMatchObject({
      route: "settings",
      activeBoardId: "board-a",
      boardMode: "active",
      projectSetupOpen: false,
      workbenchMode: "closed",
      collapsedProjectKeys: {},
    });

    useDesktopViewStore.getState().openWorkbench(workbenchInput());
    useDesktopViewStore.getState().setWorkbenchMode("narrow");
    useDesktopViewStore.getState().selectAttempt("attempt-b-3");
    expect(useDesktopViewStore.getState()).toMatchObject({
      route: "board",
      workbenchMode: "narrow",
      selectedAttemptId: "attempt-b-3",
    });

    useDesktopViewStore.getState().closeWorkbench(boards);
    expect(useDesktopViewStore.getState().pendingBoardReturn).not.toBeNull();
    useDesktopViewStore.getState().acknowledgeBoardReturn();
    useDesktopViewStore.getState().dismissWorkbench();
    expect(useDesktopViewStore.getState().pendingBoardReturn).toBeNull();
  });

  test("records board A mode and anchor while opening card B from another board", () => {
    useDesktopViewStore.getState().openWorkbench(workbenchInput());

    const state = useDesktopViewStore.getState();
    expect(state.activeBoardId).toBe("board-b");
    expect(state.workbenchMode).toBe("desktop");
    expect(state.selectedCard).toEqual({
      repositoryKey: "/projects/beta",
      boardId: "board-b",
      cardId: "card-b",
    });
    expect(state.selectedAttemptId).toBe("attempt-b-2");
    expect(state.workbenchOrigin).toEqual(workbenchInput().origin);
  });

  test("restores origin board, mode, anchor, selected card, and focus target when closing", () => {
    useDesktopViewStore.getState().openWorkbench(workbenchInput());
    useDesktopViewStore.getState().closeWorkbench(boards);

    const state = useDesktopViewStore.getState();
    expect(state.activeBoardId).toBe("board-a");
    expect(state.boardMode).toBe("active");
    expect(state.workbenchMode).toBe("closed");
    expect(state.selectedCard).toEqual({
      repositoryKey: "/projects/alpha",
      boardId: "board-a",
      cardId: "card-a",
    });
    expect(state.pendingBoardReturn).toEqual({
      ...workbenchInput().origin,
      reason: "closed",
    });
    expect(state.navigationAnnouncement).toBe("Returned to the originating workflow board.");
  });

  test("preserves a still-valid card and attempt across projection refresh", () => {
    useDesktopViewStore.getState().openWorkbench(workbenchInput());
    useDesktopViewStore.getState().reconcileBoardReferences({
      boards,
      loadedBoardId: "board-b",
      loadedCardIds: ["card-b", "card-b-other"],
    });
    useDesktopViewStore.getState().reconcileAttemptReferences({
      cardId: "card-b",
      attemptIds: ["attempt-b-1", "attempt-b-2", "attempt-b-3"],
      latestAttemptId: "attempt-b-3",
    });

    const state = useDesktopViewStore.getState();
    expect(state.workbenchMode).toBe("desktop");
    expect(state.selectedCard?.cardId).toBe("card-b");
    expect(state.selectedAttemptId).toBe("attempt-b-2");
  });

  test("falls back to the latest attempt when only the selected attempt disappears", () => {
    useDesktopViewStore.getState().openWorkbench(workbenchInput());
    useDesktopViewStore.getState().selectReview({
      evidenceId: "evidence-b",
      attemptId: "attempt-b-2",
      fileId: "file-b",
    });
    useDesktopViewStore.getState().reconcileAttemptReferences({
      cardId: "card-b",
      attemptIds: ["attempt-b-1", "attempt-b-3"],
      latestAttemptId: "attempt-b-3",
    });

    const state = useDesktopViewStore.getState();
    expect(state.workbenchMode).toBe("desktop");
    expect(state.selectedCard?.cardId).toBe("card-b");
    expect(state.selectedAttemptId).toBe("attempt-b-3");
    expect(state.selectedReview).toBeNull();
    expect(state.navigationAnnouncement).toBe(
      "The selected attempt is no longer available. Opened the latest available attempt.",
    );
  });

  test("closes to the valid origin when the selected card disappears", () => {
    useDesktopViewStore.getState().openWorkbench(workbenchInput());
    useDesktopViewStore.getState().reconcileBoardReferences({
      boards,
      loadedBoardId: "board-b",
      loadedCardIds: ["card-other"],
    });

    const state = useDesktopViewStore.getState();
    expect(state.workbenchMode).toBe("closed");
    expect(state.activeBoardId).toBe("board-a");
    expect(state.selectedAttemptId).toBeNull();
    expect(state.pendingBoardReturn?.reason).toBe("selected_card_missing");
    expect(state.navigationAnnouncement).toContain("selected card is no longer available");
  });

  test("chooses the nearest stable board when selected and origin boards disappear", () => {
    useDesktopViewStore.getState().openWorkbench(workbenchInput());
    useDesktopViewStore.getState().reconcileBoardReferences({
      boards: [
        { repositoryKey: "/projects/alpha", boardId: "board-a-2" },
        { repositoryKey: "/projects/alpha", boardId: "board-a-1" },
        { repositoryKey: "/projects/gamma", boardId: "board-c" },
      ],
      loadedBoardId: null,
      loadedCardIds: [],
    });

    const state = useDesktopViewStore.getState();
    expect(state.workbenchMode).toBe("closed");
    expect(state.activeBoardId).toBe("board-a-1");
    expect(state.pendingBoardReturn).toEqual({
      repositoryKey: "/projects/alpha",
      boardId: "board-a-1",
      boardMode: "active",
      anchor: { stageId: null, cardId: null, scrollLeft: 0, scrollTop: 0 },
      focusTargetId: null,
      reason: "selected_board_missing",
    });
  });

  test("isolates drafts across projects, boards, cards, and sources", () => {
    const namespaces: readonly DraftNamespace[] = [
      { projectKey: "/projects/alpha", boardId: "board-a", cardId: "card-a", source: "composer" },
      { projectKey: "/projects/beta", boardId: "board-a", cardId: "card-a", source: "composer" },
      { projectKey: "/projects/alpha", boardId: "board-b", cardId: "card-a", source: "composer" },
      { projectKey: "/projects/alpha", boardId: "board-a", cardId: "card-b", source: "composer" },
      { projectKey: "/projects/alpha", boardId: "board-a", cardId: "card-a", source: "request_changes" },
    ];

    namespaces.forEach((namespace, index) => {
      useDesktopViewStore.getState().setDraft(namespace, `draft-${index}`);
    });

    const state = useDesktopViewStore.getState();
    const keys = namespaces.map(createDraftKey);
    expect(new Set(keys).size).toBe(namespaces.length);
    expect(keys.map((key) => state.drafts[key])).toEqual([
      "draft-0",
      "draft-1",
      "draft-2",
      "draft-3",
      "draft-4",
    ]);
    expect(keys.map((key) => window.localStorage.getItem(key))).toEqual([
      "draft-0",
      "draft-1",
      "draft-2",
      "draft-3",
      "draft-4",
    ]);
  });

  test("restores the exact valid Settings origin including attempt, review, draft, anchor, and responsive surface", () => {
    const input = workbenchInput({ mode: "narrow" });
    const namespace: DraftNamespace = {
      projectKey: input.target.repositoryKey,
      boardId: input.target.boardId,
      cardId: input.target.cardId,
      source: "request_changes",
    };
    useDesktopViewStore.getState().setActiveBoardContext(
      input.target.repositoryKey,
      input.target.boardId,
    );
    useDesktopViewStore.getState().openWorkbench(input);
    useDesktopViewStore.getState().selectReview({
      evidenceId: "evidence-b",
      attemptId: "attempt-b-2",
      fileId: "file-b",
    });
    useDesktopViewStore.getState().selectDraftNamespace(namespace);
    useDesktopViewStore.getState().enterSettings("card-composer-draft");

    expect(useDesktopViewStore.getState().settingsReturnContext).toEqual({
      repositoryKey: input.target.repositoryKey,
      boardId: input.target.boardId,
      cardId: input.target.cardId,
      attemptId: "attempt-b-2",
      workbenchMode: "narrow",
      review: {
        evidenceId: "evidence-b",
        attemptId: "attempt-b-2",
        fileId: "file-b",
      },
      boardAnchor: input.origin.anchor,
      draftNamespace: namespace,
      responsiveSurface: "review",
      focusTargetId: "card-composer-draft",
    });
    expect(useDesktopViewStore.getState().route).toBe("settings");
    expect(useDesktopViewStore.getState().pendingFocusRequest?.targetId).toBe("settings-heading");

    useDesktopViewStore.getState().returnFromSettings();
    expect(useDesktopViewStore.getState()).toMatchObject({
      route: "board",
      activeRepositoryKey: input.target.repositoryKey,
      activeBoardId: input.target.boardId,
      workbenchMode: "narrow",
      selectedCard: input.target,
      selectedAttemptId: "attempt-b-2",
      selectedReview: {
        evidenceId: "evidence-b",
        attemptId: "attempt-b-2",
        fileId: "file-b",
      },
      activeDraftNamespace: namespace,
      settingsReturnContext: null,
      navigationAnnouncement: "Returned from Settings to the previous workspace.",
      pendingFocusRequest: {
        targetId: "card-composer-draft",
        fallbackTargetId: "board-main-heading",
      },
    });
  });

  test("announces a deterministic board fallback when the Settings origin disappears", () => {
    useDesktopViewStore.getState().openWorkbench(workbenchInput());
    useDesktopViewStore.getState().enterSettings();
    useDesktopViewStore.getState().returnFromSettings();
    useDesktopViewStore.getState().reconcileBoardReferences({
      boards: [{ repositoryKey: "/projects/alpha", boardId: "board-a-1" }],
      loadedBoardId: null,
      loadedCardIds: [],
    });

    expect(useDesktopViewStore.getState()).toMatchObject({
      route: "board",
      activeBoardId: "board-a-1",
      workbenchMode: "closed",
      selectedCard: null,
      navigationAnnouncement: "The selected board is no longer available. Returned to the nearest available board.",
    });
  });

  test("falls back to in-memory drafts when localStorage is unavailable", () => {
    const namespace: DraftNamespace = {
      projectKey: "/projects/alpha",
      boardId: "board-a",
      cardId: "card-a",
      source: "composer",
    };
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem() { throw new Error("storage unavailable"); },
        setItem() { throw new Error("storage unavailable"); },
        removeItem() { throw new Error("storage unavailable"); },
      },
    });
    try {
      useDesktopViewStore.getState().setDraft(namespace, "memory-safe");
      useDesktopViewStore.setState({ drafts: {} });
      useDesktopViewStore.getState().ensureDraft(namespace);
      expect(useDesktopViewStore.getState().drafts[createDraftKey(namespace)]).toBe("memory-safe");
    } finally {
      if (descriptor === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
      else Object.defineProperty(globalThis, "localStorage", descriptor);
    }
  });

  test("hydrates persisted drafts, clears them, and reconciles closed-board references", () => {
    const namespace: DraftNamespace = {
      projectKey: "/projects/alpha/",
      boardId: "board-a",
      cardId: "card-a",
      source: "composer",
    };
    const key = createDraftKey(namespace);
    window.localStorage.setItem(key, "persisted");
    useDesktopViewStore.getState().ensureDraft(namespace);
    useDesktopViewStore.getState().ensureDraft(namespace);
    expect(useDesktopViewStore.getState().drafts[key]).toBe("persisted");

    useDesktopViewStore.getState().setDraft(namespace, "");
    expect(window.localStorage.getItem(key)).toBeNull();

    const legacyNamespace: DraftNamespace = {
      projectKey: "/projects/alpha",
      boardId: "board-a",
      cardId: "card-legacy",
      source: "composer",
    };
    window.localStorage.setItem("kitten:inspector-draft:card-legacy", "legacy draft");
    useDesktopViewStore.getState().ensureDraft(legacyNamespace);
    expect(useDesktopViewStore.getState().drafts[createDraftKey(legacyNamespace)]).toBe("legacy draft");
    expect(window.localStorage.getItem(createDraftKey(legacyNamespace))).toBe("legacy draft");

    useDesktopViewStore.getState().openWorkbench(workbenchInput());
    useDesktopViewStore.getState().closeWorkbench(boards);
    useDesktopViewStore.getState().reconcileBoardReferences({
      boards,
      loadedBoardId: "board-a",
      loadedCardIds: [],
    });
    expect(useDesktopViewStore.getState().selectedCard).toBeNull();

    useDesktopViewStore.getState().selectBoard("board-missing");
    useDesktopViewStore.getState().reconcileBoardReferences({
      boards,
      loadedBoardId: null,
      loadedCardIds: [],
    });
    expect(useDesktopViewStore.getState().activeBoardId).toBe("board-a");

    useDesktopViewStore.getState().selectBoard("board-missing");
    useDesktopViewStore.getState().reconcileBoardReferences({
      boards: [],
      loadedBoardId: null,
      loadedCardIds: [],
    });
    expect(useDesktopViewStore.getState().activeBoardId).toBeUndefined();
  });

  test("resets ephemeral view state without adopting or changing host projections", () => {
    const hostProjection = Object.freeze({
      revision: 42,
      cards: Object.freeze([{ cardId: "card-b", status: "running" }]),
    });
    const namespace: DraftNamespace = {
      projectKey: "/projects/beta",
      boardId: "board-b",
      cardId: "card-b",
      source: "composer",
    };
    useDesktopViewStore.getState().setDraft(namespace, "keep this");
    useDesktopViewStore.getState().selectAttempt("ignored-without-card");
    useDesktopViewStore.getState().openWorkbench(workbenchInput());
    useDesktopViewStore.getState().resetEphemeralViewState();

    const state = useDesktopViewStore.getState();
    expect(state.workbenchMode).toBe("closed");
    expect(state.selectedCard).toBeNull();
    expect(state.selectedAttemptId).toBeNull();
    expect(state.drafts[createDraftKey(namespace)]).toBe("keep this");
    expect(hostProjection).toEqual({
      revision: 42,
      cards: [{ cardId: "card-b", status: "running" }],
    });
    expect("cards" in state).toBeFalse();
    expect("attempts" in state).toBeFalse();
    expect("evidence" in state).toBeFalse();
  });
});
