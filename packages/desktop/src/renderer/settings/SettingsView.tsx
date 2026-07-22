import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Chip, Skeleton } from "@heroui/react";
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
import { SelectField } from "../components/SelectField.tsx";

export interface SettingsFeedbackValue {
  readonly tone: "status" | "error";
  readonly message: string;
}

export function SettingsFeedback({ feedback }: { readonly feedback: SettingsFeedbackValue }) {
  return (
    <Alert
      status={feedback.tone === "error" ? "danger" : "success"}
      role={feedback.tone === "error" ? "alert" : "status"}
    >
      <Alert.Content><Alert.Description>{feedback.message}</Alert.Description></Alert.Content>
    </Alert>
  );
}

export function SettingsLoadingState() {
  return <main className="app-shell settings-shell" aria-busy="true"><div className="settings-content"><h1>Settings</h1>{[0, 1, 2].map((item) => <Skeleton key={item} className="h-40 rounded-lg" />)}<span className="sr-only">Loading settings…</span></div></main>;
}

export function SettingsUnavailableState({ retry }: { readonly retry: () => void }) {
  return (
    <main className="app-shell settings-shell" role="alert">
      <h1>Settings unavailable</h1>
      <p>{settingsUnavailableMessage()}</p>
      <Button onPress={retry}>Retry settings</Button>
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
      <div className="settings-content">
      <header className="app-header">
        <div className="app-header-copy">
          <p className="eyebrow">Local configuration</p>
          <h1>Settings</h1>
        </div>
        <Chip size="sm" variant="soft">Revision {current.revision}</Chip>
      </header>

      <p className="m-0 text-sm text-muted">Defaults apply to future cards only. Recorded tasks, attempts, and run contexts are never rewritten.</p>

      {feedback !== null ? (
        <SettingsFeedback feedback={feedback} />
      ) : null}

      <Card className="settings-panel" aria-labelledby="theme-title">
        <Card.Header><div><Card.Title id="theme-title">Theme preference</Card.Title><Card.Description>Choose how Kitten follows the desktop appearance.</Card.Description></div></Card.Header>
        <Card.Content>
        <SelectField
          label="Theme"
          value={current.preferences.theme}
          disabled={busySection !== null}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          onChange={(value) => {
              const theme = value as typeof current.preferences.theme;
              void run(
                "preferences",
                () => client.updatePreferences(commandId("preferences"), {
                  expectedRevision: current.revision,
                  theme,
                }),
                "Theme preference saved.",
              );
          }}
        />
        </Card.Content>
      </Card>

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
      </div>
    </main>
  );
}
