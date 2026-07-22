import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Button } from "@heroui/react";
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
    getCatalog(catalogId) {
      return rpc.request.getCatalog(catalogId === undefined ? {} : { catalogId });
    },
    pickRepositoryDirectory() {
      return rpc.request.pickRepositoryDirectory({});
    },
    executeWorkflowCommand(commandId, command) {
      return rpc.request.executeWorkflowCommand({ commandId, command });
    },
    startAttempt(commandId, input) {
      return rpc.request.startAttempt({ commandId, input });
    },
    queueFollowUp(commandId, input) {
      return rpc.request.queueFollowUp({ commandId, input });
    },
    removeQueuedFollowUp(commandId, input) {
      return rpc.request.removeQueuedFollowUp({ commandId, input });
    },
    confirmQueuedFollowUp(commandId, input) {
      return rpc.request.confirmQueuedFollowUp({ commandId, input });
    },
    answerAttention(commandId, input) {
      return rpc.request.answerAttention({ commandId, input });
    },
    reviewCard(commandId, input) {
      return rpc.request.reviewCard({ commandId, input });
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
      subscribers.clear();
      view.rpcHandler = undefined;
      view.bunSocket?.close();
    },
  };
}

export function DesktopApp({ client }: { readonly client: DesktopRpcClient }) {
  const [bootstrap, setBootstrap] = useState<BootstrapEnvelope | null>(null);
  const [route, setRoute] = useState<"board" | "settings">("board");

  useEffect(() => {
    const lifecycle = bindDesktopRenderer(client, setBootstrap);
    return () => lifecycle.dispose();
  }, [client]);

  useEffect(() => {
    if (bootstrap?.result.status !== "ok") return;
    applyThemePreference(bootstrap.result.projection.settings.theme);
  }, [bootstrap]);

  if (bootstrap === null) return <main aria-busy="true">Loading Kitten Orchestrator…</main>;
  if (bootstrap.result.status === "unavailable") {
    return <main role="alert">Desktop host unavailable.</main>;
  }

  return (
    <>
      <nav className="app-route-nav" aria-label="Application views">
        <Button
          size="sm"
          variant={route === "board" ? "secondary" : "ghost"}
          aria-current={route === "board" ? "page" : undefined}
          onPress={() => setRoute("board")}
        >
          <BoardIcon />Board
        </Button>
        <Button
          size="sm"
          variant={route === "settings" ? "secondary" : "ghost"}
          aria-current={route === "settings" ? "page" : undefined}
          onPress={() => setRoute("settings")}
        >
          <SettingsIcon />Settings
        </Button>
      </nav>
      {route === "board"
        ? <WorkflowBoard client={client} onOpenSettings={() => setRoute("settings")} />
        : <SettingsView client={client} />}
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
