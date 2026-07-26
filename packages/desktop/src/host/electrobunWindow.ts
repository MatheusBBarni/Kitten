import type { DesktopWindowFactory } from "../main.ts";
import type { DesktopRpcSchema, HostMessageEnvelope } from "../shared/rpc.ts";
import { writeFileSync } from "node:fs";
import {
  buildNativeCaptureDriverScript,
  type NativeCaptureRuntime,
} from "../../test/native/nativeCaptureRuntime.ts";

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

export interface ElectrobunWindowBindings {
  readonly ApplicationMenu: {
    setApplicationMenu(menu: ReturnType<typeof nativeApplicationMenu>): void;
  };
  readonly BrowserView: {
    defineRPC<T>(options: unknown): unknown;
  };
  readonly BrowserWindow: new (options: {
    readonly title: string;
    readonly url: string;
    readonly frame: {
      readonly width: number;
      readonly height: number;
      readonly x: number;
      readonly y: number;
    };
    readonly rpc: unknown;
  }) => ElectrobunDesktopWindow & {
    readonly webview: ElectrobunDesktopWindow["webview"] & {
      on(event: "dom-ready", listener: () => void): void;
      executeJavascript(script: string): void;
    };
  };
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

export function createElectrobunRequestHandlers(
  {
    onGetDesktopSnapshot,
    onGetCardInspector,
    onGetBoard,
    onGetWorkspace,
    onGetSupervision,
    onGetReviewManifest,
    onGetReviewDiffChunk,
    onGetCatalog,
    onPickRepositoryDirectory,
    onExecuteWorkflowCommand,
    onSubmitCardPrompt,
    onStopAttempt,
    onAnswerAttention,
    onReviewCard,
    onGetSettings,
    onUpdatePreferences,
    onUpdateProfileDefaults,
    onUpdateCatalogRoots,
    onSetExecutionLimit,
  }: Parameters<DesktopWindowFactory["open"]>[0],
) {
  return {
    getDesktopSnapshot: onGetDesktopSnapshot,
    getCardInspector: onGetCardInspector,
    getBoard: onGetBoard,
    getWorkspace: onGetWorkspace,
    getSupervision: onGetSupervision,
    getReviewManifest: onGetReviewManifest,
    getReviewDiffChunk: onGetReviewDiffChunk,
    getCatalog: onGetCatalog,
    pickRepositoryDirectory: onPickRepositoryDirectory,
    executeWorkflowCommand: onExecuteWorkflowCommand,
    submitCardPrompt: onSubmitCardPrompt,
    stopAttempt: onStopAttempt,
    answerAttention: onAnswerAttention,
    reviewCard: onReviewCard,
    getSettings: onGetSettings,
    updatePreferences: onUpdatePreferences,
    updateProfileDefaults: onUpdateProfileDefaults,
    updateCatalogRoots: onUpdateCatalogRoots,
    setExecutionLimit: onSetExecutionLimit,
  };
}

export function createNativeCaptureReadyHandler(runtime: NativeCaptureRuntime | null) {
  return (input: {
    readonly fixtureId: string;
    readonly state: string;
    readonly result: "ready" | "failed";
    readonly reason?: string;
  }): { readonly accepted: boolean } => {
    if (
      runtime === null
      || input.fixtureId !== runtime.fixture.fixtureId
      || input.state !== runtime.fixture.state
    ) {
      return { accepted: false };
    }
    writeFileSync(runtime.readyPath, `${JSON.stringify({
      matrixVersion: runtime.matrixVersion,
      fixtureId: input.fixtureId,
      state: input.state,
      result: input.result,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      readyAt: Date.now(),
    })}\n`);
    return { accepted: true };
  };
}

export async function createElectrobunWindowFactory(
  nativeCapture: NativeCaptureRuntime | null = null,
): Promise<DesktopWindowFactory> {
  const bindings = await import("electrobun/bun") as unknown as ElectrobunWindowBindings;
  return createElectrobunWindowFactoryWithBindings(bindings, nativeCapture);
}

export function createElectrobunWindowFactoryWithBindings(
  { ApplicationMenu, BrowserView, BrowserWindow }: ElectrobunWindowBindings,
  nativeCapture: NativeCaptureRuntime | null = null,
): DesktopWindowFactory {
  ApplicationMenu.setApplicationMenu(nativeApplicationMenu());
  const reportNativeCaptureReady = createNativeCaptureReadyHandler(nativeCapture);

  return {
    open(options) {
      const rpc = BrowserView.defineRPC<DesktopRpcSchema>({
        maxRequestTime: 5_000,
        handlers: {
          requests: {
            reportNativeCaptureReady,
            ...createElectrobunRequestHandlers(options),
          },
        },
      });
      const window = new BrowserWindow({
        title: "Kitten Orchestrator",
        url: "views://main/index.html",
        frame: nativeCapture === null
          ? { width: 1280, height: 800, x: 80, y: 80 }
          : {
              width: nativeCapture.window.width,
              height: nativeCapture.window.height,
              x: 80,
              y: 80,
            },
        rpc,
      });
      if (nativeCapture !== null) {
        window.webview.on("dom-ready", () => {
          window.webview.executeJavascript(
            buildNativeCaptureDriverScript(nativeCapture),
          );
        });
      }
      return createElectrobunDesktopWindowPort(window);
    },
  };
}
