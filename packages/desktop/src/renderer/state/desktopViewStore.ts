import { create } from "zustand";

export type DesktopRoute = "board" | "settings";
export type BoardMode = "active" | "new";
export type WorkbenchMode = "closed" | "desktop" | "narrow";
export type DraftSource = "composer" | "request_changes";

export interface BoardAnchor {
  readonly stageId: string | null;
  readonly cardId: string | null;
  readonly scrollLeft: number;
  readonly scrollTop: number;
}

export interface WorkbenchOrigin {
  readonly repositoryKey: string;
  readonly boardId: string;
  readonly boardMode: BoardMode;
  readonly anchor: BoardAnchor;
  readonly focusTargetId: string | null;
}

export interface WorkbenchSelection {
  readonly repositoryKey: string;
  readonly boardId: string;
  readonly cardId: string;
}

export interface BoardReference {
  readonly repositoryKey: string;
  readonly boardId: string;
}

export interface BoardReturnContext extends WorkbenchOrigin {
  readonly reason: "closed" | "selected_card_missing" | "selected_board_missing";
}

export interface DraftNamespace {
  readonly projectKey: string;
  readonly boardId: string;
  readonly cardId: string;
  readonly source: DraftSource;
}

export interface ReviewSelection {
  readonly evidenceId: string;
  readonly attemptId: string;
  readonly fileId: string | null;
}

export interface FocusRequest {
  readonly targetId: string;
  readonly fallbackTargetId: string | null;
}

export interface SettingsReturnContext {
  readonly repositoryKey: string | null;
  readonly boardId: string | null;
  readonly cardId: string | null;
  readonly attemptId: string | null;
  readonly workbenchMode: WorkbenchMode;
  readonly review: ReviewSelection | null;
  readonly boardAnchor: BoardAnchor | null;
  readonly draftNamespace: DraftNamespace | null;
  readonly responsiveSurface: "board" | "workbench_desktop" | "workbench_narrow" | "review";
  readonly focusTargetId: string | null;
}

export interface OpenWorkbenchInput {
  readonly target: WorkbenchSelection;
  readonly attemptId?: string | null;
  readonly mode: Exclude<WorkbenchMode, "closed">;
  readonly origin: WorkbenchOrigin;
}

export interface BoardReferenceRefresh {
  readonly boards: readonly BoardReference[];
  readonly loadedBoardId: string | null;
  readonly loadedCardIds: readonly string[];
}

export interface AttemptReferenceRefresh {
  readonly cardId: string;
  readonly attemptIds: readonly string[];
  readonly latestAttemptId: string | null;
}

interface DesktopViewState {
  readonly route: DesktopRoute;
  readonly activeRepositoryKey: string | null;
  readonly activeBoardId: string | undefined;
  readonly boardMode: BoardMode;
  readonly projectSetupOpen: boolean;
  readonly collapsedProjectKeys: Readonly<Record<string, true>>;
  readonly workbenchMode: WorkbenchMode;
  readonly selectedCard: WorkbenchSelection | null;
  readonly selectedAttemptId: string | null;
  readonly workbenchOrigin: WorkbenchOrigin | null;
  readonly pendingBoardReturn: BoardReturnContext | null;
  readonly navigationAnnouncement: string | null;
  readonly selectedReview: ReviewSelection | null;
  readonly activeDraftNamespace: DraftNamespace | null;
  readonly settingsReturnContext: SettingsReturnContext | null;
  readonly pendingFocusRequest: FocusRequest | null;
  readonly drafts: Readonly<Record<string, string>>;
  setRoute(route: DesktopRoute): void;
  setActiveBoardContext(repositoryKey: string, boardId: string): void;
  selectBoard(boardId: string): void;
  beginProjectSetup(): void;
  finishProjectSetup(boardId: string): void;
  cancelProjectSetup(): void;
  setInitialBoard(boardId: string): void;
  toggleProjectExpanded(projectKey: string): void;
  openWorkbench(input: OpenWorkbenchInput): void;
  setWorkbenchMode(mode: Exclude<WorkbenchMode, "closed">): void;
  closeWorkbench(boards: readonly BoardReference[], reason?: BoardReturnContext["reason"]): void;
  dismissWorkbench(): void;
  reconcileBoardReferences(refresh: BoardReferenceRefresh): void;
  reconcileAttemptReferences(refresh: AttemptReferenceRefresh): void;
  selectAttempt(attemptId: string): void;
  selectReview(review: ReviewSelection | null): void;
  selectDraftNamespace(namespace: DraftNamespace | null): void;
  enterSettings(focusTargetId?: string | null): void;
  returnFromSettings(): void;
  requestFocus(targetId: string, fallbackTargetId?: string | null): void;
  acknowledgeFocusRequest(): void;
  announce(message: string): void;
  acknowledgeBoardReturn(): void;
  ensureDraft(namespace: DraftNamespace): void;
  setDraft(namespace: DraftNamespace, draft: string): void;
  resetEphemeralViewState(): void;
}

const DRAFT_STORAGE_PREFIX = "kitten:workbench-draft:v2";
const memoryDrafts = new Map<string, string>();

function normalizedProjectKey(projectKey: string): string {
  return projectKey.replaceAll("\\", "/").replace(/\/+$/, "");
}

function legacyDraftKey(namespace: DraftNamespace): string | null {
  return namespace.source === "composer"
    ? `kitten:inspector-draft:${namespace.cardId}`
    : null;
}

export function createDraftKey(namespace: DraftNamespace): string {
  return [
    DRAFT_STORAGE_PREFIX,
    normalizedProjectKey(namespace.projectKey),
    namespace.boardId,
    namespace.cardId,
    namespace.source,
  ].map(encodeURIComponent).join(":");
}

function readPersistedDraft(key: string, legacyKey: string | null): string {
  try {
    if (typeof localStorage !== "undefined") {
      const persisted = localStorage.getItem(key);
      if (persisted !== null) {
        memoryDrafts.set(key, persisted);
        return persisted;
      }
      if (legacyKey !== null) {
        const legacyDraft = localStorage.getItem(legacyKey);
        if (legacyDraft !== null) {
          memoryDrafts.set(key, legacyDraft);
          localStorage.setItem(key, legacyDraft);
          return legacyDraft;
        }
      }
    }
  } catch {
    // The in-memory copy remains authoritative when browser storage is unavailable.
  }
  return memoryDrafts.get(key) ?? "";
}

function writePersistedDraft(key: string, draft: string): void {
  if (draft.length === 0) memoryDrafts.delete(key);
  else memoryDrafts.set(key, draft);
  try {
    if (typeof localStorage === "undefined") return;
    if (draft.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, draft);
  } catch {
    // Keep the in-memory copy so editing remains safe in restricted renderers.
  }
}

function stableBoardReferences(boards: readonly BoardReference[]): readonly BoardReference[] {
  return [...boards].sort((left, right) => (
    left.repositoryKey.localeCompare(right.repositoryKey)
    || left.boardId.localeCompare(right.boardId)
  ));
}

function resolveBoardReturn(
  origin: WorkbenchOrigin | null,
  selection: WorkbenchSelection | null,
  boards: readonly BoardReference[],
  reason: BoardReturnContext["reason"],
): BoardReturnContext | null {
  const ordered = stableBoardReferences(boards);
  if (ordered.length === 0) return null;

  const exactOrigin = origin === null
    ? undefined
    : ordered.find(({ boardId }) => boardId === origin.boardId);
  if (origin !== null && exactOrigin !== undefined) return { ...origin, reason };

  const sameRepository = origin === null
    ? undefined
    : ordered.find(({ repositoryKey }) => repositoryKey === origin.repositoryKey);
  const selectedBoard = selection === null
    ? undefined
    : ordered.find(({ boardId }) => boardId === selection.boardId);
  const fallback = sameRepository ?? selectedBoard ?? ordered[0]!;
  return {
    repositoryKey: fallback.repositoryKey,
    boardId: fallback.boardId,
    boardMode: "active",
    anchor: { stageId: null, cardId: null, scrollLeft: 0, scrollTop: 0 },
    focusTargetId: null,
    reason,
  };
}

function returnAnnouncement(boardReturn: BoardReturnContext | null): string {
  if (boardReturn === null) return "The workbench closed. No workflow board is available.";
  if (boardReturn.reason === "selected_card_missing") {
    return "The selected card is no longer available. Returned to the nearest available board.";
  }
  if (boardReturn.reason === "selected_board_missing") {
    return "The selected board is no longer available. Returned to the nearest available board.";
  }
  return "Returned to the originating workflow board.";
}

function selectionFromBoardReturn(boardReturn: BoardReturnContext | null): WorkbenchSelection | null {
  if (boardReturn?.anchor.cardId === null || boardReturn?.anchor.cardId === undefined) return null;
  return {
    repositoryKey: boardReturn.repositoryKey,
    boardId: boardReturn.boardId,
    cardId: boardReturn.anchor.cardId,
  };
}

const initialEphemeralState = {
  route: "board" as const,
  activeRepositoryKey: null,
  activeBoardId: undefined,
  boardMode: "active" as const,
  projectSetupOpen: false,
  workbenchMode: "closed" as const,
  selectedCard: null,
  selectedAttemptId: null,
  workbenchOrigin: null,
  pendingBoardReturn: null,
  navigationAnnouncement: null,
  selectedReview: null,
  activeDraftNamespace: null,
  settingsReturnContext: null,
  pendingFocusRequest: null,
};

export const useDesktopViewStore = create<DesktopViewState>()((set, get) => ({
  ...initialEphemeralState,
  collapsedProjectKeys: {},
  drafts: {},
  setRoute: (route) => set({ route }),
  setActiveBoardContext: (activeRepositoryKey, activeBoardId) => set({
    activeRepositoryKey,
    activeBoardId,
  }),
  selectBoard: (activeBoardId) => set({
    activeBoardId,
    boardMode: "active",
    projectSetupOpen: false,
  }),
  beginProjectSetup: () => set({
    boardMode: "new",
    projectSetupOpen: true,
    workbenchMode: "closed",
    selectedCard: null,
    selectedAttemptId: null,
    selectedReview: null,
    activeDraftNamespace: null,
    workbenchOrigin: null,
    pendingBoardReturn: null,
  }),
  finishProjectSetup: (activeBoardId) => set({
    activeBoardId,
    boardMode: "active",
    projectSetupOpen: false,
  }),
  cancelProjectSetup: () => set({ boardMode: "active", projectSetupOpen: false }),
  setInitialBoard: (activeBoardId) => set((state) => (
    state.activeBoardId === undefined && state.boardMode === "active"
      ? { activeBoardId }
      : state
  )),
  toggleProjectExpanded: (projectKey) => set((state) => {
    if (state.collapsedProjectKeys[projectKey] === true) {
      const { [projectKey]: _removed, ...collapsedProjectKeys } = state.collapsedProjectKeys;
      return { collapsedProjectKeys };
    }
    return { collapsedProjectKeys: { ...state.collapsedProjectKeys, [projectKey]: true } };
  }),
  openWorkbench: (input) => set((state) => ({
    route: "board",
    activeBoardId: input.target.boardId,
    boardMode: "active",
    projectSetupOpen: false,
    workbenchMode: input.mode,
    selectedCard: input.target,
    selectedAttemptId: input.attemptId ?? null,
    selectedReview: null,
    workbenchOrigin: state.workbenchMode === "closed" ? input.origin : state.workbenchOrigin,
    pendingBoardReturn: null,
    navigationAnnouncement: null,
  })),
  setWorkbenchMode: (workbenchMode) => set((state) => (
    state.workbenchMode === "closed" ? state : { workbenchMode }
  )),
  closeWorkbench: (boards, reason = "closed") => set((state) => {
    const pendingBoardReturn = resolveBoardReturn(
      state.workbenchOrigin,
      state.selectedCard,
      boards,
      reason,
    );
    return {
      activeBoardId: pendingBoardReturn?.boardId,
      boardMode: pendingBoardReturn?.boardMode ?? "active",
      workbenchMode: "closed",
      selectedCard: selectionFromBoardReturn(pendingBoardReturn),
      selectedAttemptId: null,
      selectedReview: null,
      activeDraftNamespace: null,
      workbenchOrigin: null,
      pendingBoardReturn,
      navigationAnnouncement: returnAnnouncement(pendingBoardReturn),
    };
  }),
  dismissWorkbench: () => set({
    workbenchMode: "closed",
    selectedCard: null,
    selectedAttemptId: null,
    selectedReview: null,
    activeDraftNamespace: null,
    workbenchOrigin: null,
    pendingBoardReturn: null,
    navigationAnnouncement: null,
  }),
  reconcileBoardReferences: (refresh) => set((state) => {
    const boardIds = new Set(refresh.boards.map(({ boardId }) => boardId));
    const selectedBoardMissing = state.selectedCard !== null
      && !boardIds.has(state.selectedCard.boardId);
    const selectedCardMissing = state.selectedCard !== null
      && refresh.loadedBoardId === state.selectedCard.boardId
      && !refresh.loadedCardIds.includes(state.selectedCard.cardId);

    if (
      state.workbenchMode !== "closed"
      && (selectedBoardMissing || selectedCardMissing)
    ) {
      const reason = selectedBoardMissing
        ? "selected_board_missing" as const
        : "selected_card_missing" as const;
      const pendingBoardReturn = resolveBoardReturn(
        state.workbenchOrigin,
        state.selectedCard,
        refresh.boards,
        reason,
      );
      return {
        activeBoardId: pendingBoardReturn?.boardId,
        boardMode: pendingBoardReturn?.boardMode ?? "active",
        workbenchMode: "closed",
        selectedCard: selectionFromBoardReturn(pendingBoardReturn),
        selectedAttemptId: null,
        selectedReview: null,
        activeDraftNamespace: null,
        workbenchOrigin: null,
        pendingBoardReturn,
        navigationAnnouncement: returnAnnouncement(pendingBoardReturn),
      };
    }

    if (state.workbenchMode === "closed" && selectedCardMissing) {
      return { selectedCard: null };
    }

    if (
      state.workbenchMode === "closed"
      && state.activeBoardId !== undefined
      && !boardIds.has(state.activeBoardId)
    ) {
      const fallback = stableBoardReferences(refresh.boards)[0];
      return {
        activeBoardId: fallback?.boardId,
        boardMode: "active",
        selectedCard: null,
        selectedAttemptId: null,
        selectedReview: null,
        activeDraftNamespace: null,
        navigationAnnouncement: fallback === undefined
          ? "No workflow board is available."
          : "The active board is no longer available. Opened the nearest available board.",
      };
    }
    return state;
  }),
  reconcileAttemptReferences: (refresh) => set((state) => {
    if (state.selectedCard?.cardId !== refresh.cardId) return state;
    const selectedAttemptValid = state.selectedAttemptId !== null
      && refresh.attemptIds.includes(state.selectedAttemptId);
    const selectedReviewValid = state.selectedReview === null
      || refresh.attemptIds.includes(state.selectedReview.attemptId);
    if (selectedAttemptValid && selectedReviewValid) return state;
    const selectedAttemptId = selectedAttemptValid
      ? state.selectedAttemptId
      : refresh.latestAttemptId;
    return {
      selectedAttemptId,
      selectedReview: selectedReviewValid ? state.selectedReview : null,
      navigationAnnouncement: selectedAttemptValid
        ? "The selected review is no longer available. Returned to the selected attempt."
        : selectedAttemptId === null
          ? "The selected attempt is no longer available. No attempt is currently available."
          : "The selected attempt is no longer available. Opened the latest available attempt.",
    };
  }),
  selectAttempt: (selectedAttemptId) => set((state) => (
    state.selectedCard === null ? state : { selectedAttemptId }
  )),
  selectReview: (selectedReview) => set({ selectedReview }),
  selectDraftNamespace: (activeDraftNamespace) => set({ activeDraftNamespace }),
  enterSettings: (focusTargetId = null) => set((state) => {
    if (state.route === "settings") return state;
    const repositoryKey = state.selectedCard?.repositoryKey
      ?? state.workbenchOrigin?.repositoryKey
      ?? state.activeRepositoryKey;
    const boardId = state.selectedCard?.boardId
      ?? state.workbenchOrigin?.boardId
      ?? state.activeBoardId
      ?? null;
    const responsiveSurface = state.selectedReview !== null
      ? "review" as const
      : state.workbenchMode === "desktop"
        ? "workbench_desktop" as const
        : state.workbenchMode === "narrow"
          ? "workbench_narrow" as const
          : "board" as const;
    return {
      route: "settings",
      settingsReturnContext: {
        repositoryKey,
        boardId,
        cardId: state.selectedCard?.cardId ?? null,
        attemptId: state.selectedAttemptId,
        workbenchMode: state.workbenchMode,
        review: state.selectedReview,
        boardAnchor: state.workbenchOrigin?.anchor ?? state.pendingBoardReturn?.anchor ?? null,
        draftNamespace: state.activeDraftNamespace,
        responsiveSurface,
        focusTargetId,
      },
      pendingFocusRequest: {
        targetId: "settings-heading",
        fallbackTargetId: null,
      },
      navigationAnnouncement: "Settings opened.",
    };
  }),
  returnFromSettings: () => set((state) => {
    if (state.route !== "settings") return state;
    const context = state.settingsReturnContext;
    const restoredFocus = context?.focusTargetId
      ?? (context?.cardId === null || context?.cardId === undefined
        ? "board-main-heading"
        : `card-open-${context.cardId}`);
    return {
      route: "board",
      activeRepositoryKey: context?.repositoryKey ?? state.activeRepositoryKey,
      activeBoardId: context?.boardId ?? state.activeBoardId,
      workbenchMode: context?.workbenchMode ?? state.workbenchMode,
      selectedCard: context?.repositoryKey !== null
        && context?.repositoryKey !== undefined
        && context.boardId !== null
        && context.cardId !== null
        ? {
            repositoryKey: context.repositoryKey,
            boardId: context.boardId,
            cardId: context.cardId,
          }
        : state.selectedCard,
      selectedAttemptId: context?.attemptId ?? state.selectedAttemptId,
      selectedReview: context?.review ?? state.selectedReview,
      activeDraftNamespace: context?.draftNamespace ?? state.activeDraftNamespace,
      pendingFocusRequest: {
        targetId: restoredFocus,
        fallbackTargetId: "board-main-heading",
      },
      navigationAnnouncement: "Returned from Settings to the previous workspace.",
      settingsReturnContext: null,
    };
  }),
  requestFocus: (targetId, fallbackTargetId = null) => set({
    pendingFocusRequest: { targetId, fallbackTargetId },
  }),
  acknowledgeFocusRequest: () => set({ pendingFocusRequest: null }),
  announce: (navigationAnnouncement) => set({ navigationAnnouncement }),
  acknowledgeBoardReturn: () => set({ pendingBoardReturn: null }),
  ensureDraft: (namespace) => {
    const key = createDraftKey(namespace);
    if (Object.hasOwn(get().drafts, key)) return;
    set((state) => ({
      drafts: {
        ...state.drafts,
        [key]: readPersistedDraft(key, legacyDraftKey(namespace)),
      },
    }));
  },
  setDraft: (namespace, draft) => {
    const key = createDraftKey(namespace);
    writePersistedDraft(key, draft);
    set((state) => ({ drafts: { ...state.drafts, [key]: draft } }));
  },
  resetEphemeralViewState: () => set(initialEphemeralState),
}));

export function resetDesktopViewStore(): void {
  memoryDrafts.clear();
  useDesktopViewStore.setState(useDesktopViewStore.getInitialState(), true);
}
