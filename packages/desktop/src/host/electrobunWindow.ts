import type { DesktopWindowFactory } from "../main.ts";
import type { DesktopRpcSchema } from "../shared/rpc.ts";

export async function createElectrobunWindowFactory(): Promise<DesktopWindowFactory> {
  const { BrowserView, BrowserWindow } = await import("electrobun/bun");

  return {
    open({
      onGetDesktopSnapshot,
      onGetCardInspector,
      onGetBoard,
      onGetCatalog,
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
            getCatalog: onGetCatalog,
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
    },
  };
}
