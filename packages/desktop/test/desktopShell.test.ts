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
  type HostMessageEnvelope,
} from "../src/shared/rpc.ts";
import {
  bindDesktopRenderer,
  type DesktopRpcClient,
} from "../src/renderer/client.ts";

class FakeWindowFactory implements DesktopWindowFactory {
  handler?: (params: { readonly knownRevision?: number }) => Promise<BootstrapEnvelope>;
  readonly messages: HostMessageEnvelope[] = [];
  handlerRemovalCount = 0;
  closeCount = 0;

  open({ onGetDesktopSnapshot }: Parameters<DesktopWindowFactory["open"]>[0]) {
    this.handler = onGetDesktopSnapshot;
    return {
      sendHostMessage: (message: HostMessageEnvelope) => this.messages.push(message),
      removeHandlers: () => {
        this.handler = undefined;
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
    for (const version of [
      ...Object.values(manifest.dependencies),
      ...Object.values(manifest.devDependencies),
    ]) {
      expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    }
    expect(manifest.devDependencies.electrobun).toBe("1.18.1");
    expect(manifest.dependencies.react).toBe("19.2.7");
    expect(manifest.dependencies["react-dom"]).toBe("19.2.7");
  });
});
