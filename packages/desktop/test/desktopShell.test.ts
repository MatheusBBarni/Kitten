import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  startDesktopShell,
  type DesktopWindowFactory,
} from "../src/main.ts";
import {
  ProjectionBoundaryError,
  assertProjectionPayload,
  createBootstrapEnvelope,
  createCommandResultEnvelope,
  createEmptyDesktopSnapshot,
  type BootstrapEnvelope,
  type CardInspectorEnvelope,
  type HostMessageEnvelope,
} from "../src/shared/rpc.ts";
import {
  bindDesktopRenderer,
  type DesktopRpcClient,
} from "../src/renderer/client.ts";
import type { DesktopFollowUpRpc } from "../src/host/desktopRpc.ts";

class FakeWindowFactory implements DesktopWindowFactory {
  handler?: (params: { readonly knownRevision?: number }) => Promise<BootstrapEnvelope>;
  inspectorHandler?: (params: { readonly cardId: string }) => Promise<CardInspectorEnvelope>;
  queueHandler?: Parameters<DesktopWindowFactory["open"]>[0]["onQueueFollowUp"];
  removeQueueHandler?: Parameters<DesktopWindowFactory["open"]>[0]["onRemoveQueuedFollowUp"];
  confirmQueueHandler?: Parameters<DesktopWindowFactory["open"]>[0]["onConfirmQueuedFollowUp"];
  readonly messages: HostMessageEnvelope[] = [];
  handlerRemovalCount = 0;
  closeCount = 0;

  open({
    onGetDesktopSnapshot,
    onGetCardInspector,
    onQueueFollowUp,
    onRemoveQueuedFollowUp,
    onConfirmQueuedFollowUp,
  }: Parameters<DesktopWindowFactory["open"]>[0]) {
    this.handler = onGetDesktopSnapshot;
    this.inspectorHandler = onGetCardInspector;
    this.queueHandler = onQueueFollowUp;
    this.removeQueueHandler = onRemoveQueuedFollowUp;
    this.confirmQueueHandler = onConfirmQueuedFollowUp;
    return {
      sendHostMessage: (message: HostMessageEnvelope) => this.messages.push(message),
      removeHandlers: () => {
        this.handler = undefined;
        this.inspectorHandler = undefined;
        this.queueHandler = undefined;
        this.removeQueueHandler = undefined;
        this.confirmQueueHandler = undefined;
        this.handlerRemovalCount += 1;
      },
      close: () => {
        this.closeCount += 1;
      },
    };
  }
}

describe("typed desktop RPC contract", () => {
  test("discriminates bootstrap, conflict, and unavailable outcomes", () => {
    const bootstrap = createBootstrapEnvelope({
      status: "ok",
      projection: createEmptyDesktopSnapshot(),
    });
    const conflict = createCommandResultEnvelope<never>("command-1", {
      status: "conflict",
      conflict: { kind: "stale_projection", expectedRevision: 1, actualRevision: 2 },
    });
    const unavailable = createCommandResultEnvelope<never>("command-2", {
      status: "unavailable",
      unavailable: { resource: "desktop_host", reason: "not_ready" },
    });

    expect(bootstrap.kind).toBe("bootstrap");
    expect(bootstrap.result.status).toBe("ok");
    expect(conflict.kind).toBe("command_result");
    expect(conflict.result.status).toBe("conflict");
    if (conflict.result.status === "conflict") {
      expect(conflict.result.conflict.actualRevision).toBe(2);
    }
    expect(unavailable.result.status).toBe("unavailable");
    if (unavailable.result.status === "unavailable") {
      expect(unavailable.result.unavailable.reason).toBe("not_ready");
    }
  });

  test("rejects privileged resources, secrets, class instances, and cycles", () => {
    for (const key of [
      "acpConnection",
      "filesystemHandle",
      "sqliteHandle",
      "skillContents",
      "worktree",
      "apiToken",
    ]) {
      expect(() => assertProjectionPayload({ [key]: {} })).toThrow(ProjectionBoundaryError);
    }
    expect(() => assertProjectionPayload({ openedAt: new Date() })).toThrow(
      "resource handles and class instances are forbidden",
    );
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => assertProjectionPayload(cyclic)).toThrow("cyclic projection values are forbidden");
    expect(() => assertProjectionPayload({ count: Number.NaN })).toThrow("must be JSON data");
    const shared = { id: "projection-1" };
    expect(assertProjectionPayload({ first: shared, second: shared })).toEqual({
      first: shared,
      second: shared,
    });
  });
});

describe("desktop host lifecycle", () => {
  test("registers and forwards typed follow-up queue operations with a not-ready fallback", async () => {
    const unavailableFactory = new FakeWindowFactory();
    startDesktopShell({ windowFactory: unavailableFactory });
    const request = {
      commandId: "follow-up-command",
      input: {
        attemptId: "attempt-1",
        generation: 1,
        expectedQueueVersion: 0,
        queueId: "queue-1",
        text: "follow up",
      },
    } as never;
    expect(await unavailableFactory.queueHandler?.(request)).toMatchObject({
      result: { status: "rejected", reason: { code: "invalid_state" } },
    });

    const calls: string[] = [];
    const ok = (commandId: string) => ({
      kind: "follow_up_command_result" as const,
      commandId,
      result: { status: "ok" as const, projection: null },
    });
    const followUpRpc: DesktopFollowUpRpc = {
      async queueFollowUp(value) { calls.push("queue"); return ok(value.commandId); },
      async removeQueuedFollowUp(value) { calls.push("remove"); return ok(value.commandId); },
      async confirmQueuedFollowUp(value) { calls.push("confirm"); return ok(value.commandId); },
    };
    const factory = new FakeWindowFactory();
    startDesktopShell({ windowFactory: factory, followUpRpc });
    expect((await factory.queueHandler?.(request))?.result.status).toBe("ok");
    expect((await factory.removeQueueHandler?.(request))?.result.status).toBe("ok");
    expect((await factory.confirmQueueHandler?.(request))?.result.status).toBe("ok");
    expect(calls).toEqual(["queue", "remove", "confirm"]);
  });

  test("registers bootstrap, delivers messages, and removes everything on teardown", async () => {
    const factory = new FakeWindowFactory();
    const shell = startDesktopShell({ windowFactory: factory });

    expect(factory.handler).toBeFunction();
    const registeredHandler = factory.handler;
    const bootstrap = await registeredHandler?.({});
    expect(bootstrap?.result).toEqual({
      status: "ok",
      projection: createEmptyDesktopSnapshot(),
    });

    const message: HostMessageEnvelope = {
      kind: "projection_committed",
      messageId: "message-1",
      revision: 1,
    };
    expect(shell.publish(message)).toBeTrue();
    expect(factory.messages).toEqual([message]);

    shell.stop();
    shell.stop();
    expect(factory.handler).toBeUndefined();
    expect(factory.handlerRemovalCount).toBe(1);
    expect(factory.closeCount).toBe(1);
    expect(shell.publish(message)).toBeFalse();
    expect(await registeredHandler?.({})).toEqual({
      kind: "bootstrap",
      result: {
        status: "unavailable",
        unavailable: { resource: "desktop_host", reason: "host_stopped" },
      },
    });
  });

  test("fails closed when a snapshot provider exposes a privileged value", async () => {
    const factory = new FakeWindowFactory();
    startDesktopShell({
      windowFactory: factory,
      getSnapshot: () => ({ ...createEmptyDesktopSnapshot(), secret: "nope" }) as never,
    });

    expect(await factory.handler?.({})).toEqual({
      kind: "bootstrap",
      result: {
        status: "unavailable",
        unavailable: { resource: "desktop_snapshot", reason: "projection_rejected" },
      },
    });
  });

  test("fails closed for unavailable, missing, stopped, and rejected inspector projections", async () => {
    const unavailableFactory = new FakeWindowFactory();
    const unavailableShell = startDesktopShell({ windowFactory: unavailableFactory });
    expect(await unavailableFactory.inspectorHandler?.({ cardId: "card-1" })).toEqual({
      kind: "card_inspector",
      result: {
        status: "unavailable",
        unavailable: { resource: "card_inspector", reason: "not_ready" },
      },
    });
    expect(await unavailableFactory.inspectorHandler?.({ cardId: "   " })).toMatchObject({
      result: { status: "unavailable", unavailable: { reason: "not_ready" } },
    });
    const stoppedHandler = unavailableFactory.inspectorHandler;
    unavailableShell.stop();
    expect(await stoppedHandler?.({ cardId: "card-1" })).toMatchObject({
      result: { status: "unavailable", unavailable: { resource: "desktop_host", reason: "host_stopped" } },
    });

    const missingFactory = new FakeWindowFactory();
    const missingShell = startDesktopShell({
      windowFactory: missingFactory,
      getCardInspector: () => null,
    });
    expect(await missingFactory.inspectorHandler?.({ cardId: "card-missing" })).toMatchObject({
      result: { status: "unavailable", unavailable: { resource: "card_inspector", reason: "not_ready" } },
    });
    missingShell.stop();

    const rejectedFactory = new FakeWindowFactory();
    const rejectedShell = startDesktopShell({
      windowFactory: rejectedFactory,
      getCardInspector() { throw new Error("unsafe projection"); },
    });
    expect(await rejectedFactory.inspectorHandler?.({ cardId: "card-1" })).toMatchObject({
      result: { status: "unavailable", unavailable: { resource: "card_inspector", reason: "projection_rejected" } },
    });
    rejectedShell.stop();
  });
});

describe("renderer lifecycle", () => {
  test("loads only through the client and cleans up its subscription", async () => {
    let snapshotRequests = 0;
    let subscriber: ((message: HostMessageEnvelope) => void) | undefined;
    let unsubscribeCount = 0;
    let disposeCount = 0;
    const envelopes: BootstrapEnvelope[] = [];
    const client: DesktopRpcClient = {
      async getDesktopSnapshot() {
        snapshotRequests += 1;
        return createBootstrapEnvelope({
          status: "ok",
          projection: createEmptyDesktopSnapshot(),
        });
      },
      async getCardInspector() {
        throw new Error("not used by bootstrap lifecycle");
      },
      subscribe(listener) {
        subscriber = listener;
        return () => {
          subscriber = undefined;
          unsubscribeCount += 1;
        };
      },
      dispose() {
        disposeCount += 1;
      },
    };

    const lifecycle = bindDesktopRenderer(client, (envelope) => envelopes.push(envelope));
    await lifecycle.ready;
    subscriber?.({ kind: "projection_committed", messageId: "message-2", revision: 1 });
    await Bun.sleep(0);

    expect(snapshotRequests).toBe(2);
    expect(envelopes).toHaveLength(2);
    lifecycle.dispose();
    lifecycle.dispose();
    expect(unsubscribeCount).toBe(1);
    expect(disposeCount).toBe(1);
    expect(subscriber).toBeUndefined();
  });
});

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : [path];
    }),
  );
  return files.flat().filter((path) => /\.(?:ts|tsx)$/.test(path));
}

describe("desktop package boundaries", () => {
  test("renderer imports no host implementation", async () => {
    const rendererDirectory = join(import.meta.dir, "../src/renderer");
    for (const path of await sourceFiles(rendererDirectory)) {
      const source = await readFile(path, "utf8");
      expect(source).not.toMatch(/from\s+["'][^"']*(?:\/host\/|\/main\.ts|electrobun\/bun)/);
    }
  });

  test("registers no HTTP listener", async () => {
    const sourceDirectory = join(import.meta.dir, "../src");
    for (const path of await sourceFiles(sourceDirectory)) {
      const source = await readFile(path, "utf8");
      expect(source).not.toMatch(/Bun\.serve|node:http|createServer\s*\(|from\s+["']https?["']/);
    }
  });

  test("keeps SQLite imports inside the desktop host persistence package", async () => {
    const sourceDirectory = join(import.meta.dir, "../src");
    for (const path of await sourceFiles(sourceDirectory)) {
      const source = await readFile(path, "utf8");
      if (source.includes('from "bun:sqlite"')) {
        expect(path).toContain("/src/persistence/");
        expect(path).not.toContain("/src/renderer/");
      }
    }
  });

  test("keeps every direct desktop dependency exact-pinned", async () => {
    const manifest = JSON.parse(
      await readFile(join(import.meta.dir, "../package.json"), "utf8"),
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(manifest.dependencies["@kitten/engine"]).toBe("workspace:*");
    for (const version of [
      ...Object.entries(manifest.dependencies)
        .filter(([name]) => name !== "@kitten/engine")
        .map(([, version]) => version),
      ...Object.values(manifest.devDependencies),
    ]) {
      expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    }
    expect(manifest.devDependencies.electrobun).toBe("1.18.1");
    expect(manifest.dependencies.react).toBe("19.2.7");
    expect(manifest.dependencies["react-dom"]).toBe("19.2.7");
  });
});
