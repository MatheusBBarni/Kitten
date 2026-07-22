import { useEffect, useRef, useState } from "react";
import type { DesktopRpcClient } from "../client.ts";
import type {
  DesktopSettingsProjection,
  SettingsCommandEnvelope,
  SettingsSection,
} from "../../shared/desktopRpc.ts";
import { bindSettingsQuery, settingsUnavailableMessage, type SettingsQueryBinding } from "./settingsQueries.ts";
import { ProfileDefaultsPanel } from "./ProfileDefaultsPanel.tsx";
import { CatalogRootsPanel } from "./CatalogRootsPanel.tsx";
import { ExecutionLimitPanel } from "./ExecutionLimitPanel.tsx";

export interface SettingsFeedbackValue {
  readonly tone: "status" | "error";
  readonly message: string;
}

export function SettingsFeedback({ feedback }: { readonly feedback: SettingsFeedbackValue }) {
  return (
    <p
      className={feedback.tone === "error" ? "notice notice-error" : "notice"}
      role={feedback.tone === "error" ? "alert" : "status"}
    >
      {feedback.message}
    </p>
  );
}

export function SettingsLoadingState() {
  return <main className="app-shell settings-shell" aria-busy="true"><h1>Settings</h1><p>Loading settings…</p></main>;
}

export function SettingsUnavailableState({ retry }: { readonly retry: () => void }) {
  return (
    <main className="app-shell settings-shell" role="alert">
      <h1>Settings unavailable</h1>
      <p>{settingsUnavailableMessage()}</p>
      <button type="button" className="button button-primary" onClick={retry}>Retry settings</button>
    </main>
  );
}

function commandId(section: SettingsSection): string {
  return `settings:${section}:${crypto.randomUUID()}`;
}

export function SettingsView({ client }: { readonly client: DesktopRpcClient }) {
  const [projection, setProjection] = useState<DesktopSettingsProjection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busySection, setBusySection] = useState<SettingsSection | null>(null);
  const [feedback, setFeedback] = useState<SettingsFeedbackValue | null>(null);
  const binding = useRef<SettingsQueryBinding | null>(null);

  useEffect(() => {
    const next = bindSettingsQuery(client, (envelope) => {
      if (envelope.result.status === "ok") {
        setProjection(envelope.result.projection);
        setLoadError(null);
      } else {
        setLoadError(settingsUnavailableMessage());
      }
    });
    binding.current = next;
    return () => {
      binding.current = null;
      next.dispose();
    };
  }, [client]);

  async function run(
    section: SettingsSection,
    execute: () => Promise<SettingsCommandEnvelope>,
    successMessage: string,
  ) {
    if (busySection !== null) return;
    setBusySection(section);
    try {
      const envelope = await execute();
      if (envelope.result.status === "ok") {
        setProjection(envelope.result.projection);
        setFeedback({ tone: "status", message: successMessage });
      } else if (envelope.result.status === "conflict") {
        setFeedback({
          tone: "error",
          message: `Settings changed before this action was committed. Expected revision ${envelope.result.conflict.expectedRevision}, now ${envelope.result.conflict.actualRevision}. Review the refreshed values and try again.`,
        });
        await binding.current?.refresh();
      } else if (envelope.result.status === "rejected") {
        setFeedback({ tone: "error", message: envelope.result.rejection.message });
      } else {
        setFeedback({ tone: "error", message: settingsUnavailableMessage() });
      }
    } catch {
      setFeedback({ tone: "error", message: settingsUnavailableMessage() });
    } finally {
      setBusySection(null);
    }
  }

  if (projection === null && loadError === null) {
    return <SettingsLoadingState />;
  }
  if (projection === null) {
    return <SettingsUnavailableState retry={() => void binding.current?.refresh()} />;
  }

  const current = projection;
  return (
    <main className="app-shell settings-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Host-owned configuration</p>
          <h1>Settings</h1>
          <p>Defaults apply to future cards only. Recorded cards, attempts, and Run Contexts are not rewritten.</p>
        </div>
        <p className="revision">Settings revision {current.revision}</p>
      </header>

      {feedback !== null ? (
        <SettingsFeedback feedback={feedback} />
      ) : null}

      <section className="settings-panel" aria-labelledby="theme-title">
        <h2 id="theme-title">Theme preference</h2>
        <label className="field">
          <span>Theme</span>
          <select
            value={current.preferences.theme}
            disabled={busySection !== null}
            onChange={(event) => {
              const theme = event.currentTarget.value as typeof current.preferences.theme;
              void run(
                "preferences",
                () => client.updatePreferences(commandId("preferences"), {
                  expectedRevision: current.revision,
                  theme,
                }),
                "Theme preference saved.",
              );
            }}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </section>

      <ProfileDefaultsPanel
        key={`${current.profileDefaults.profileId}:${current.profileDefaults.model}:${current.profileDefaults.effort}`}
        profiles={current.profiles}
        defaults={current.profileDefaults}
        busy={busySection !== null}
        onSave={(defaults) => void run(
          "profile_defaults",
          () => client.updateProfileDefaults(commandId("profile_defaults"), {
            expectedRevision: current.revision,
            ...defaults,
          }),
          "Future-card profile default saved.",
        )}
      />

      <CatalogRootsPanel
        key={current.catalog.roots.map((root) => `${root.rootClass}:${root.configuredPath}`).join("|")}
        catalog={current.catalog}
        busy={busySection !== null}
        onSave={(roots) => void run(
          "catalog_roots",
          () => client.updateCatalogRoots(commandId("catalog_roots"), {
            expectedRevision: current.revision,
            ...roots,
          }),
          "Catalog roots saved and scanned.",
        )}
      />

      <ExecutionLimitPanel
        key={current.scheduler.automaticExecutionLimit}
        limit={current.scheduler.automaticExecutionLimit}
        activeCount={current.scheduler.activeCount}
        busy={busySection !== null}
        onSave={(limit) => void run(
          "execution_limit",
          () => client.setExecutionLimit(commandId("execution_limit"), {
            expectedRevision: current.revision,
            limit,
          }),
          "Automatic execution limit saved.",
        )}
      />
    </main>
  );
}
