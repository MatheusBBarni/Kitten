import type { DesktopWindowFactory } from "../main.ts";
import type { DesktopRpcSchema, HostMessageEnvelope } from "../shared/rpc.ts";

export interface ElectrobunDesktopWindow {
  readonly webview: {
    readonly rpc?: {
      readonly send: {
        hostMessage(message: HostMessageEnvelope): void;
      };
    };
    remove(): void;
  };
  show(): void;
  close(): void;
}

export function createElectrobunDesktopWindowPort(window: ElectrobunDesktopWindow): ReturnType<DesktopWindowFactory["open"]> {
  // Constructing a native window and revealing it are separate host actions.
  // Reveal it before the shell begins serving renderer RPC.
  window.show();
  let handlersRemoved = false;

  return {
    sendHostMessage(message) {
      if (handlersRemoved) return;
      window.webview.rpc?.send.hostMessage(message);
    },
    removeHandlers() {
      if (handlersRemoved) return;
      handlersRemoved = true;
      window.webview.remove();
    },
    close() {
      window.close();
    },
  };
}

export function nativeApplicationMenu() {
  return [
    {
      label: "Kitten Orchestrator",
      submenu: [
        { role: "about" as const },
        { type: "separator" as const },
        { role: "hide" as const },
        { role: "hideOthers" as const },
        { role: "showAll" as const },
        { type: "separator" as const },
        { role: "quit" as const },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" as const },
        { role: "redo" as const },
        { type: "separator" as const },
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        { role: "pasteAndMatchStyle" as const },
        { role: "delete" as const },
        { role: "selectAll" as const },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" as const },
        { role: "zoom" as const },
        { type: "separator" as const },
        { role: "front" as const },
      ],
    },
  ];
}

export async function createElectrobunWindowFactory(): Promise<DesktopWindowFactory> {
  const { ApplicationMenu, BrowserView, BrowserWindow } = await import("electrobun/bun");
  ApplicationMenu.setApplicationMenu(nativeApplicationMenu());

  return {
    open({
      onGetDesktopSnapshot,
      onGetCardInspector,
      onGetBoard,
      onGetWorkspace,
      onGetCatalog,
      onPickRepositoryDirectory,
      onExecuteWorkflowCommand,
      onQueueFollowUp,
      onRemoveQueuedFollowUp,
      onConfirmQueuedFollowUp,
      onStartAttempt,
      onAnswerAttention,
      onReviewCard,
      onGetSettings,
      onUpdatePreferences,
      onUpdateProfileDefaults,
      onUpdateCatalogRoots,
      onSetExecutionLimit,
    }) {
      const rpc = BrowserView.defineRPC<DesktopRpcSchema>({
        maxRequestTime: 5_000,
        handlers: {
          requests: {
            getDesktopSnapshot: onGetDesktopSnapshot,
            getCardInspector: onGetCardInspector,
            getBoard: onGetBoard,
            getWorkspace: onGetWorkspace,
            getCatalog: onGetCatalog,
            pickRepositoryDirectory: onPickRepositoryDirectory,
            executeWorkflowCommand: onExecuteWorkflowCommand,
            queueFollowUp: onQueueFollowUp,
            removeQueuedFollowUp: onRemoveQueuedFollowUp,
            confirmQueuedFollowUp: onConfirmQueuedFollowUp,
            startAttempt: onStartAttempt,
            answerAttention: onAnswerAttention,
            reviewCard: onReviewCard,
            getSettings: onGetSettings,
            updatePreferences: onUpdatePreferences,
            updateProfileDefaults: onUpdateProfileDefaults,
            updateCatalogRoots: onUpdateCatalogRoots,
            setExecutionLimit: onSetExecutionLimit,
          },
        },
      });
      const window = new BrowserWindow({
        title: "Kitten Orchestrator",
        url: "views://main/index.html",
        frame: { width: 1280, height: 800, x: 80, y: 80 },
        rpc,
      });
      return createElectrobunDesktopWindowPort(window);
    },
  };
}
