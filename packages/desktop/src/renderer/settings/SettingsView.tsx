import { Alert, Button, Card, Chip, Skeleton } from "@heroui/react";
import type { DesktopRpcClient } from "../client.ts";
import { settingsUnavailableMessage } from "./settingsQueries.ts";
import { ProfileDefaultsPanel } from "./ProfileDefaultsPanel.tsx";
import { CatalogRootsPanel } from "./CatalogRootsPanel.tsx";
import { ExecutionLimitPanel } from "./ExecutionLimitPanel.tsx";
import { SelectField } from "../components/SelectField.tsx";
import { AcpProvidersPanel } from "./AcpProvidersPanel.tsx";
import { useSettingsController } from "./useSettingsController.ts";

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

export function SettingsView({ client }: { readonly client: DesktopRpcClient }) {
  const controller = useSettingsController(client);

  if (controller.loading) {
    return <SettingsLoadingState />;
  }
  if (controller.projection === null || controller.unavailable) {
    return <SettingsUnavailableState retry={() => void controller.retry()} />;
  }

  const current = controller.projection;
  const busySection = controller.busySection;
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

      <p className="m-0 text-sm text-muted">Defaults apply only when you create a task. Existing tasks, attempts, and run history are never rewritten.</p>

      {controller.feedback !== null ? (
        <SettingsFeedback feedback={controller.feedback} />
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
              controller.saveTheme(theme);
          }}
        />
        </Card.Content>
      </Card>

      <AcpProvidersPanel providers={current.acpProviders} />

      <ProfileDefaultsPanel
        key={`${current.profileDefaults.profileId}:${current.profileDefaults.model}:${current.profileDefaults.effort}`}
        profiles={current.profiles}
        defaults={current.profileDefaults}
        busy={busySection !== null}
        onSave={controller.saveProfileDefaults}
      />

      <CatalogRootsPanel
        key={current.catalog.roots.map((root) => `${root.rootClass}:${root.configuredPath}`).join("|")}
        catalog={current.catalog}
        busy={busySection !== null}
        onSave={controller.saveCatalogRoots}
      />

      <ExecutionLimitPanel
        key={current.scheduler.automaticExecutionLimit}
        limit={current.scheduler.automaticExecutionLimit}
        activeCount={current.scheduler.activeCount}
        busy={busySection !== null}
        onSave={controller.saveExecutionLimit}
      />
      </div>
    </main>
  );
}
