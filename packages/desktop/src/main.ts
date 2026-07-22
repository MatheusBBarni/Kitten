import {
  assertHostMessage,
  createBootstrapEnvelope,
  createEmptyDesktopSnapshot,
  type BootstrapEnvelope,
  type DesktopSnapshot,
  type HostMessageEnvelope,
} from "./shared/rpc.ts";

export interface DesktopWindowPort {
  sendHostMessage(message: HostMessageEnvelope): void;
  removeHandlers(): void;
  close(): void;
}

export interface DesktopWindowFactory {
  open(options: {
    onGetDesktopSnapshot(params: { readonly knownRevision?: number }): Promise<BootstrapEnvelope>;
  }): DesktopWindowPort;
}

export interface DesktopShell {
  publish(message: HostMessageEnvelope): boolean;
  stop(): void;
}

export function startDesktopShell(options: {
  readonly windowFactory: DesktopWindowFactory;
  readonly getSnapshot?: () => DesktopSnapshot | Promise<DesktopSnapshot>;
}): DesktopShell {
  let stopped = false;
  const getSnapshot = options.getSnapshot ?? createEmptyDesktopSnapshot;

  const window = options.windowFactory.open({
    async onGetDesktopSnapshot() {
      if (stopped) {
        return createBootstrapEnvelope({
          status: "unavailable",
          unavailable: { resource: "desktop_host", reason: "host_stopped" },
        });
      }

      try {
        return createBootstrapEnvelope({ status: "ok", projection: await getSnapshot() });
      } catch {
        return createBootstrapEnvelope({
          status: "unavailable",
          unavailable: { resource: "desktop_snapshot", reason: "projection_rejected" },
        });
      }
    },
  });

  return {
    publish(message) {
      if (stopped) return false;
      window.sendHostMessage(assertHostMessage(message));
      return true;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      window.removeHandlers();
      window.close();
    },
  };
}

export async function main(): Promise<DesktopShell> {
  const { createElectrobunWindowFactory } = await import("./host/electrobunWindow.ts");
  return startDesktopShell({ windowFactory: await createElectrobunWindowFactory() });
}

if (import.meta.main) {
  await main();
}
