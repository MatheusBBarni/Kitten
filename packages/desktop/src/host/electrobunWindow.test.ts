import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createElectrobunDesktopWindowPort,
  createElectrobunRequestHandlers,
  createElectrobunWindowFactoryWithBindings,
  createNativeCaptureReadyHandler,
  nativeApplicationMenu,
  type ElectrobunWindowBindings,
  type ElectrobunDesktopWindow,
} from "./electrobunWindow.ts";
import type { DesktopWindowFactory } from "../main.ts";
import {
  createEmptySupervisionProjection,
  createReviewDiffChunkEnvelope,
  createReviewManifestEnvelope,
  createSupervisionEnvelope,
} from "../shared/rpc.ts";
import { declaredLifecycleFixture } from "../../test/native/lifecycleMatrix.ts";

test("declares native Edit roles so macOS standard shortcuts reach focused fields", () => {
  const edit = nativeApplicationMenu().find(({ label }) => label === "Edit");
  expect(edit?.submenu.map((item) => "role" in item ? item.role : item.type)).toEqual([
    "undo",
    "redo",
    "separator",
    "cut",
    "copy",
    "paste",
    "pasteAndMatchStyle",
    "delete",
    "selectAll",
  ]);
});

test("reveals the native window and stops delivering messages after handlers are removed", () => {
  const calls: string[] = [];
  const messages: string[] = [];
  const window: ElectrobunDesktopWindow = {
    webview: {
      rpc: {
        send: {
          hostMessage(message) {
            messages.push(message.kind);
          },
        },
      },
      remove() {
        calls.push("remove");
      },
    },
    show() {
      calls.push("show");
    },
    close() {
      calls.push("close");
    },
  };

  const port = createElectrobunDesktopWindowPort(window);
  expect(calls).toEqual(["show"]);

  port.sendHostMessage({ kind: "projection_committed", messageId: "projection-1", revision: 1 });
  expect(messages).toEqual(["projection_committed"]);

  port.removeHandlers();
  port.removeHandlers();
  port.sendHostMessage({ kind: "projection_committed", messageId: "projection-2", revision: 2 });
  port.close();

  expect(calls).toEqual(["show", "remove", "close"]);
  expect(messages).toEqual(["projection_committed"]);
});

test("registers getSupervision and returns a plain-JSON revisioned envelope", async () => {
  const expected = createSupervisionEnvelope({
    status: "ok",
    projection: createEmptySupervisionProjection(42),
  });
  const onGetSupervision = async () => expected;
  const handlers = createElectrobunRequestHandlers({
    onGetSupervision,
  } as unknown as Parameters<DesktopWindowFactory["open"]>[0]);

  expect(handlers.getSupervision).toBe(onGetSupervision);
  const response = await handlers.getSupervision({});
  expect(JSON.parse(JSON.stringify(response))).toEqual(expected);
  expect(response).toMatchObject({
    kind: "supervision",
    result: {
      status: "ok",
      projection: {
        revision: 42,
        groups: [
          { status: "needs_attention", items: [] },
          { status: "ready_for_review", items: [] },
          { status: "failed", items: [] },
          { status: "running", items: [] },
          { status: "settled", items: [] },
        ],
      },
    },
  });
});

test("registers both review evidence schema handlers with plain-JSON responses", async () => {
  const manifest = createReviewManifestEnvelope({
    status: "unavailable",
    unavailable: { resource: "review_manifest", reason: "not_ready" },
  });
  const chunk = createReviewDiffChunkEnvelope({
    status: "unavailable",
    unavailable: { resource: "review_diff_chunk", reason: "not_ready" },
  });
  const onGetReviewManifest = async () => manifest;
  const onGetReviewDiffChunk = async () => chunk;
  const handlers = createElectrobunRequestHandlers({
    onGetReviewManifest,
    onGetReviewDiffChunk,
  } as unknown as Parameters<DesktopWindowFactory["open"]>[0]);

  expect(handlers.getReviewManifest).toBe(onGetReviewManifest);
  expect(handlers.getReviewDiffChunk).toBe(onGetReviewDiffChunk);
  expect(JSON.parse(JSON.stringify(await handlers.getReviewManifest({
    cardId: "card-1" as never,
    evidenceId: "evidence-1",
  })))).toEqual(manifest);
  expect(JSON.parse(JSON.stringify(await handlers.getReviewDiffChunk({
    evidenceId: "evidence-1",
    fileId: "file-1",
    offset: 0,
  })))).toEqual(chunk);
});

test("writes packaged capture readiness only for the declared fixture and state", () => {
  const directory = mkdtempSync(join(tmpdir(), "kitten-native-ready-"));
  try {
    const fixture = declaredLifecycleFixture("fx-v1-running-attempt");
    const readyPath = join(directory, "capture-ready.json");
    const handler = createNativeCaptureReadyHandler({
      matrixVersion: "lifecycle-v1",
      fixture,
      databasePath: join(directory, "workflow.sqlite"),
      readyPath,
      window: { width: 1440, height: 900 },
    });

    expect(handler({
      fixtureId: fixture.fixtureId,
      state: "wrong-state",
      result: "ready",
    })).toEqual({ accepted: false });
    expect(handler({
      fixtureId: fixture.fixtureId,
      state: fixture.state,
      result: "ready",
    })).toEqual({ accepted: true });
    expect(JSON.parse(readFileSync(readyPath, "utf8"))).toMatchObject({
      matrixVersion: "lifecycle-v1",
      fixtureId: fixture.fixtureId,
      state: fixture.state,
      result: "ready",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("creates the fixed packaged window and injects the declared driver after dom-ready", () => {
  const fixture = declaredLifecycleFixture("fx-v1-running-attempt");
  const calls: string[] = [];
  const frames: Array<{ width: number; height: number; x: number; y: number }> = [];
  let domReady: (() => void) | undefined;
  let driverScript = "";
  let rpcOptions: unknown;
  class FakeBrowserWindow {
    readonly webview = {
      remove() {
        calls.push("remove");
      },
      on(_event: "dom-ready", listener: () => void) {
        domReady = listener;
      },
      executeJavascript(script: string) {
        driverScript = script;
      },
    };

    constructor(options: {
      readonly frame: { readonly width: number; readonly height: number; readonly x: number; readonly y: number };
    }) {
      frames.push({ ...options.frame });
    }

    show() {
      calls.push("show");
    }

    close() {
      calls.push("close");
    }
  }
  const bindings: ElectrobunWindowBindings = {
    ApplicationMenu: {
      setApplicationMenu() {
        calls.push("menu");
      },
    },
    BrowserView: {
      defineRPC<T>(options: unknown): unknown {
        rpcOptions = options;
        return options as T;
      },
    },
    BrowserWindow: FakeBrowserWindow as unknown as ElectrobunWindowBindings["BrowserWindow"],
  };
  const factory = createElectrobunWindowFactoryWithBindings(bindings, {
    matrixVersion: "lifecycle-v1",
    fixture,
    databasePath: "/synthetic/workflow.sqlite",
    readyPath: "/synthetic/capture-ready.json",
    window: { width: 1440, height: 900 },
  });
  const port = factory.open({} as Parameters<DesktopWindowFactory["open"]>[0]);
  expect(calls).toEqual(["menu", "show"]);
  expect(frames).toEqual([{ width: 1440, height: 900, x: 80, y: 80 }]);
  expect(rpcOptions).toMatchObject({ maxRequestTime: 5_000 });
  domReady?.();
  expect(driverScript).toContain(fixture.fixtureId);
  port.removeHandlers();
  port.close();
  expect(calls).toEqual(["menu", "show", "remove", "close"]);

  const productionPort = createElectrobunWindowFactoryWithBindings(bindings).open(
    {} as Parameters<DesktopWindowFactory["open"]>[0],
  );
  expect(frames.at(-1)).toEqual({ width: 1280, height: 800, x: 80, y: 80 });
  productionPort.removeHandlers();
  productionPort.close();
});
