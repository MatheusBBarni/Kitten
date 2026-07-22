import { create } from "zustand";

export type DesktopRoute = "board" | "settings";
export type BoardMode = "active" | "new";

interface DesktopViewState {
  readonly route: DesktopRoute;
  readonly activeBoardId: string | undefined;
  readonly boardMode: BoardMode;
  readonly projectSetupOpen: boolean;
  setRoute(route: DesktopRoute): void;
  selectBoard(boardId: string): void;
  beginProjectSetup(): void;
  finishProjectSetup(boardId: string): void;
  cancelProjectSetup(): void;
  setInitialBoard(boardId: string): void;
}

export const useDesktopViewStore = create<DesktopViewState>()((set) => ({
  route: "board",
  activeBoardId: undefined,
  boardMode: "active",
  projectSetupOpen: false,
  setRoute: (route) => set({ route }),
  selectBoard: (activeBoardId) => set({ activeBoardId, boardMode: "active", projectSetupOpen: false }),
  beginProjectSetup: () => set({ boardMode: "new", projectSetupOpen: true }),
  finishProjectSetup: (activeBoardId) => set({ activeBoardId, boardMode: "active", projectSetupOpen: false }),
  cancelProjectSetup: () => set({ boardMode: "active", projectSetupOpen: false }),
  setInitialBoard: (activeBoardId) => set((state) => (
    state.activeBoardId === undefined && state.boardMode === "active"
      ? { activeBoardId }
      : state
  )),
}));

export function resetDesktopViewStore(): void {
  useDesktopViewStore.setState(useDesktopViewStore.getInitialState(), true);
}
