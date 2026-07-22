import type { BootstrapEnvelope, HostMessageEnvelope } from "../shared/rpc.ts";

export interface DesktopRpcClient {
  getDesktopSnapshot(): Promise<BootstrapEnvelope>;
  subscribe(listener: (message: HostMessageEnvelope) => void): () => void;
  dispose(): void;
}

export function bindDesktopRenderer(
  client: DesktopRpcClient,
  onBootstrap: (envelope: BootstrapEnvelope) => void,
): { readonly ready: Promise<void>; dispose(): void } {
  let active = true;

  const refresh = async () => {
    const envelope = await client.getDesktopSnapshot();
    if (active) onBootstrap(envelope);
  };
  const unsubscribe = client.subscribe((message) => {
    if (message.kind === "projection_committed" || message.kind === "host_unavailable") {
      void refresh();
    }
  });

  return {
    ready: refresh(),
    dispose() {
      if (!active) return;
      active = false;
      unsubscribe();
      client.dispose();
    },
  };
}
