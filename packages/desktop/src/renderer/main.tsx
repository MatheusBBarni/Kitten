import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  BootstrapEnvelope,
  DesktopRpcSchema,
  HostMessageEnvelope,
} from "../shared/rpc.ts";
import {
  bindDesktopRenderer,
  type DesktopRpcClient,
} from "./client.ts";

export type { DesktopRpcClient } from "./client.ts";
export { bindDesktopRenderer } from "./client.ts";

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

  useEffect(() => {
    const lifecycle = bindDesktopRenderer(client, setBootstrap);
    return () => lifecycle.dispose();
  }, [client]);

  if (bootstrap === null) return <main aria-busy="true">Loading Kitten Orchestrator…</main>;
  if (bootstrap.result.status === "unavailable") {
    return <main role="alert">Desktop host unavailable.</main>;
  }

  return (
    <main>
      <h1>Kitten Orchestrator</h1>
      <p>The local Workflow Board is ready for setup.</p>
      <small>Projection revision {bootstrap.result.projection.revision}</small>
    </main>
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
