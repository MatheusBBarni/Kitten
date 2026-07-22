import type { DesktopRpcClient } from "../client.ts";
import type { SettingsEnvelope } from "../../shared/desktopRpc.ts";

export interface SettingsQueryBinding {
  readonly ready: Promise<void>;
  refresh(): Promise<void>;
  dispose(): void;
}

/** Refreshes only for settings commits or a host-wide availability transition. */
export function bindSettingsQuery(
  client: DesktopRpcClient,
  onSettings: (envelope: SettingsEnvelope) => void,
): SettingsQueryBinding {
  let active = true;
  let refreshSequence = 0;

  const refresh = async () => {
    const sequence = ++refreshSequence;
    const envelope = await client.getSettings();
    if (active && sequence === refreshSequence) onSettings(envelope);
  };
  const unsubscribe = client.subscribe((message) => {
    if (message.kind === "settings_committed" || message.kind === "host_unavailable") {
      void refresh();
    }
  });

  return {
    ready: refresh(),
    refresh,
    dispose() {
      if (!active) return;
      active = false;
      refreshSequence += 1;
      unsubscribe();
    },
  };
}

export function settingsUnavailableMessage(): string {
  return "Settings are unavailable from the desktop host. Retry after the host reconnects.";
}
