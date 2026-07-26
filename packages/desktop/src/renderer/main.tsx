import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Button, Toast } from "@heroui/react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import type {
  BootstrapEnvelope,
  DesktopRpcSchema,
  HostMessageEnvelope,
} from "../shared/rpc.ts";
import {
  bindDesktopRenderer,
  type DesktopRpcClient,
} from "./client.ts";
import { WorkflowBoard } from "./features/board/WorkflowBoardContainer.tsx";
import { SettingsView } from "./settings/SettingsView.tsx";
import type { SettingsTheme } from "../shared/desktopRpc.ts";
import { BoardIcon, SettingsIcon } from "./components/Icons.tsx";
import {
  bootstrapQueryOptions,
  createDesktopQueryClient,
  useDesktopHostInvalidation,
} from "./query/desktopQueries.ts";
import { useDesktopViewStore } from "./state/desktopViewStore.ts";
import {
  desktopShortcutReference,
  routeDesktopKeydown,
  type DesktopCardCommandTarget,
  type DesktopCommandContext,
  type DesktopCommandTarget,
} from "./commands/desktopCommands.ts";
import { PROJECT_SIDEBAR_SEARCH_ID } from "./features/board/ProjectSidebar.tsx";

export type { DesktopRpcClient } from "./client.ts";
export { bindDesktopRenderer } from "./client.ts";

export function applyThemePreference(theme: SettingsTheme): void {
  if (theme === "system") {
    const systemDark = typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = systemDark ? "dark" : "light";
    document.documentElement.style.colorScheme = systemDark ? "dark" : "light";
    return;
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export async function createElectrobunDesktopClient(): Promise<DesktopRpcClient> {
  const { Electroview } = await import("electrobun/view");
  const subscribers = new Set<(message: HostMessageEnvelope) => void>();
  let disposed = false;

  const rpc = Electroview.defineRPC<DesktopRpcSchema>({
    maxRequestTime: 5_000,
    handlers: {
      messages: {
        hostMessage(message) {
          if (!disposed) subscribers.forEach((subscriber) => subscriber(message));
        },
      },
    },
  });
  const view = new Electroview({ rpc });
  window.__kittenReportNativeCaptureReady = (input) => (
    rpc.request.reportNativeCaptureReady(input)
  );

  return {
    getDesktopSnapshot() {
      return rpc.request.getDesktopSnapshot({});
    },
    getCardInspector(cardId) {
      return rpc.request.getCardInspector({ cardId });
    },
    getBoard(boardId, mode) {
      return rpc.request.getBoard({
        ...(boardId === undefined ? {} : { boardId }),
        ...(mode === undefined ? {} : { mode }),
      });
    },
    getWorkspace() {
      return rpc.request.getWorkspace({});
    },
    getSupervision() {
      return rpc.request.getSupervision({});
    },
    getReviewManifest(request) {
      return rpc.request.getReviewManifest(request);
    },
    getReviewDiffChunk(request) {
      return rpc.request.getReviewDiffChunk(request);
    },
    getCatalog(catalogId) {
      return rpc.request.getCatalog(catalogId === undefined ? {} : { catalogId });
    },
    pickRepositoryDirectory() {
      return rpc.request.pickRepositoryDirectory({});
    },
    executeWorkflowCommand(commandId, command) {
      return rpc.request.executeWorkflowCommand({ commandId, command });
    },
    submitCardPrompt(input) {
      return rpc.request.submitCardPrompt(input);
    },
    stopAttempt(commandId, input) {
      return rpc.request.stopAttempt({ commandId, input });
    },
    answerAttention(commandId, input) {
      return rpc.request.answerAttention({ commandId, input });
    },
    reviewCard(input) {
      return rpc.request.reviewCard(input);
    },
    getSettings() {
      return rpc.request.getSettings({});
    },
    updatePreferences(commandId, input) {
      return rpc.request.updatePreferences({ commandId, input });
    },
    updateProfileDefaults(commandId, input) {
      return rpc.request.updateProfileDefaults({ commandId, input });
    },
    updateCatalogRoots(commandId, input) {
      return rpc.request.updateCatalogRoots({ commandId, input });
    },
    setExecutionLimit(commandId, input) {
      return rpc.request.setExecutionLimit({ commandId, input });
    },
    subscribe(listener) {
      if (disposed) return () => {};
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      delete window.__kittenReportNativeCaptureReady;
      subscribers.clear();
      view.rpcHandler = undefined;
      view.bunSocket?.close();
    },
  };
}

export function DesktopApp({ client }: { readonly client: DesktopRpcClient }) {
  const [queryClient] = useState(createDesktopQueryClient);

  useEffect(() => () => client.dispose(), [client]);

  return (
    <QueryClientProvider client={queryClient}>
      <Toast.Provider placement="bottom end" maxVisibleToasts={3} />
      <DesktopAppContent client={client} />
    </QueryClientProvider>
  );
}

function DesktopAppContent({ client }: { readonly client: DesktopRpcClient }) {
  const bootstrapQuery = useQuery(bootstrapQueryOptions(client));
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const route = useDesktopViewStore((state) => state.route);
  const workbenchMode = useDesktopViewStore((state) => state.workbenchMode);
  const navigationAnnouncement = useDesktopViewStore((state) => state.navigationAnnouncement);
  const pendingFocusRequest = useDesktopViewStore((state) => state.pendingFocusRequest);
  const enterSettings = useDesktopViewStore((state) => state.enterSettings);
  const returnFromSettings = useDesktopViewStore((state) => state.returnFromSettings);
  const acknowledgeFocusRequest = useDesktopViewStore((state) => state.acknowledgeFocusRequest);
  const announce = useDesktopViewStore((state) => state.announce);

  useDesktopHostInvalidation(client);

  useEffect(() => {
    const bootstrap = bootstrapQuery.data;
    if (bootstrap?.result.status !== "ok") return;
    applyThemePreference(bootstrap.result.projection.settings.theme);
  }, [bootstrapQuery.data]);

  useEffect(() => {
    if (pendingFocusRequest === null) return;
    const timeout = window.setTimeout(() => {
      const target = document.getElementById(pendingFocusRequest.targetId)
        ?? (pendingFocusRequest.fallbackTargetId === null
          ? null
          : document.getElementById(pendingFocusRequest.fallbackTargetId));
      target?.focus();
      acknowledgeFocusRequest();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [acknowledgeFocusRequest, pendingFocusRequest, route]);

  useEffect(() => {
    function elementTarget(element: HTMLElement | null): DesktopCommandTarget | null {
      if (element === null) return null;
      return {
        focus: () => element.focus(),
        activate: () => element.click(),
      };
    }

    function commandContext(): DesktopCommandContext {
      const cardTargets = [...document.querySelectorAll<HTMLElement>("[data-desktop-card-id]")]
        .map((element): DesktopCardCommandTarget => ({
          cardId: element.dataset.desktopCardId ?? "",
          selected: element.getAttribute("aria-pressed") === "true",
          focus: () => element.focus(),
          activate: () => element.click(),
        }));
      const reviewPanel = document.getElementById("review-panel");
      const reviewTarget = reviewPanel === null
        ? document.querySelector<HTMLElement>('[data-desktop-command-target="open-review"]')
        : reviewPanel;
      const backElement = route === "settings"
        ? null
        : document.getElementById("review-panel-close")
          ?? document.getElementById("workbench-back-trigger")
          ?? document.getElementById("workbench-close-trigger");
      return {
        modalOpen: shortcutHelpOpen
          || document.querySelector(
            '[role="alertdialog"], [role="dialog"][aria-modal="true"]:not(#card-workbench)',
          ) !== null,
        search: elementTarget(document.getElementById(PROJECT_SIDEBAR_SEARCH_ID)),
        nextActionable: elementTarget(
          document.querySelector<HTMLElement>(
            '[data-desktop-command-target="next-actionable"]:not(:disabled)',
          ),
        ),
        cards: cardTargets,
        composer: elementTarget(document.getElementById("card-composer-draft")),
        review: elementTarget(reviewTarget),
        back: route === "settings"
          ? { activate: returnFromSettings }
          : elementTarget(backElement),
        settings: route === "settings"
          ? null
          : {
              activate: () => enterSettings(
                document.activeElement instanceof HTMLElement && document.activeElement.id.length > 0
                  ? document.activeElement.id
                  : null,
              ),
            },
        help: shortcutHelpOpen ? null : { activate: () => setShortcutHelpOpen(true) },
        announce,
      };
    }

    function onKeyDown(event: KeyboardEvent) {
      routeDesktopKeydown(event, commandContext());
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [announce, enterSettings, returnFromSettings, route, shortcutHelpOpen]);

  const bootstrap = bootstrapQuery.data;
  if (bootstrap === undefined) return <main aria-busy="true">Loading Kitten Orchestrator…</main>;
  if (bootstrap.result.status === "unavailable") {
    return <main role="alert">Desktop host unavailable.</main>;
  }

  return (
    <>
      <nav
        className="fixed right-3 top-3 z-40 flex items-center gap-1 rounded-[var(--kitten-radius-control)] border border-[var(--kitten-border-subtle)] bg-[var(--kitten-surface-raised)] p-1 shadow-[var(--kitten-shadow-panel)]"
        aria-label="Application views"
        data-workbench-mode={workbenchMode}
      >
        <Button
          size="sm"
          variant={route === "board" ? "secondary" : "ghost"}
          aria-current={route === "board" ? "page" : undefined}
          onPress={() => {
            if (route === "settings") returnFromSettings();
          }}
        >
          <BoardIcon />Board
        </Button>
        <Button
          size="sm"
          variant={route === "settings" ? "secondary" : "ghost"}
          aria-current={route === "settings" ? "page" : undefined}
          onPress={() => {
            if (route !== "settings") {
              enterSettings(
                document.activeElement instanceof HTMLElement && document.activeElement.id.length > 0
                  ? document.activeElement.id
                  : null,
              );
            }
          }}
        >
          <SettingsIcon />Settings <kbd>⌘,</kbd>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={shortcutHelpOpen}
          onPress={() => setShortcutHelpOpen(true)}
        >
          Shortcuts <kbd>⌘/</kbd>
        </Button>
      </nav>
      {route === "board"
        ? <WorkflowBoard client={client} />
        : <SettingsView client={client} />}
      {navigationAnnouncement === null ? null : (
        <p className="sr-only" role="status" aria-live="polite">{navigationAnnouncement}</p>
      )}
      {shortcutHelpOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setShortcutHelpOpen(false);
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcut-help-title"
            data-desktop-command-modal="true"
            className="grid w-full max-w-lg gap-4 rounded-lg border border-separator bg-[var(--background)] p-5 shadow-xl"
          >
            <header className="flex items-center justify-between gap-3">
              <h2 id="shortcut-help-title" className="m-0">Keyboard shortcuts</h2>
              <Button autoFocus size="sm" variant="ghost" onPress={() => setShortcutHelpOpen(false)}>
                Close
              </Button>
            </header>
            <dl className="grid gap-2">
              {desktopShortcutReference().map((command) => (
                <div key={command.id} className="flex items-center justify-between gap-4">
                  <dt>{command.label}</dt>
                  <dd className="m-0"><kbd>{command.shortcut}</kbd></dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      ) : null}
    </>
  );
}

export async function mountDesktopRenderer(container: Element): Promise<{
  readonly root: Root;
  unmount(): void;
}> {
  const client = await createElectrobunDesktopClient();
  const root = createRoot(container);
  root.render(<DesktopApp client={client} />);
  return { root, unmount: () => root.unmount() };
}

if (typeof document !== "undefined") {
  const container = document.getElementById("root");
  if (container !== null) void mountDesktopRenderer(container);
}
