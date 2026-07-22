import { useState, type FormEvent } from "react";
import { Button, Card, Chip } from "@heroui/react";
import type { ProfileId } from "@kitten/engine";
import type {
  FutureCardProfileDefaults,
  SettingsProfileProjection,
} from "../../shared/desktopRpc.ts";
import { AlertIcon } from "../components/Icons.tsx";
import { SelectField } from "../components/SelectField.tsx";

interface ProfileDefaultsPanelProps {
  readonly profiles: readonly SettingsProfileProjection[];
  readonly defaults: FutureCardProfileDefaults;
  readonly busy: boolean;
  readonly onSave: (defaults: {
    readonly profileId: ProfileId | null;
    readonly model: string | null;
    readonly effort: string | null;
  }) => void;
}

export function ProfileDefaultsPanel({
  profiles,
  defaults,
  busy,
  onSave,
}: ProfileDefaultsPanelProps) {
  const readyProfiles = profiles.filter((profile) => profile.readiness.ready);
  const [profileId, setProfileId] = useState<string>(defaults.profileId ?? "");
  const selected = readyProfiles.find((profile) => profile.profileId === profileId) ?? null;
  const [model, setModel] = useState(defaults.model ?? "");
  const [effort, setEffort] = useState(defaults.effort ?? "");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(profileId.length === 0
      ? { profileId: null, model: null, effort: null }
      : { profileId: profileId as ProfileId, model, effort });
  }

  return (
    <Card className="settings-panel" aria-labelledby="profile-defaults-title">
      <Card.Header>
        <div>
          <Card.Title id="profile-defaults-title">Defaults for new tasks</Card.Title>
          <Card.Description>
            Choose the ready agent, model, and effort prefilled when you create a task. Existing tasks and run history do not change.
          </Card.Description>
        </div>
      </Card.Header>
      <Card.Content className="grid gap-4">
        {profiles.length === 0 ? null : (
          <ul
            className="m-0 grid max-h-48 list-none gap-0 overflow-y-auto overscroll-contain rounded-lg border border-separator p-0"
            aria-label="Agent profile readiness"
          >
            {profiles.map((profile) => (
              <li key={profile.profileId} className="border-t border-separator p-3 first:border-t-0">
                <strong>{profile.provider}</strong>{" "}
                <Chip size="sm" variant="soft" color={profile.readiness.ready ? "success" : "danger"}>
                  {profile.readiness.ready ? "Ready" : "Needs setup"}
                </Chip>
                {profile.readiness.ready ? null : <span className="ml-2 text-muted">{profile.readiness.message}</span>}
              </li>
            ))}
          </ul>
        )}

        {readyProfiles.length === 0 ? (
          <div
            className="grid grid-cols-[1rem_minmax(0,1fr)] gap-3 rounded-lg border border-warning bg-[var(--warning-soft)] p-3 text-[var(--warning-soft-foreground)]"
            role="status"
          >
            <AlertIcon />
            <div>
              <strong>No ready task agents</strong>
              <p className="mb-0 mt-1 text-[0.8125rem] leading-5">
                Kitten can detect installed ACP clients above, but none has completed the readiness check required to run tasks.
                You can still create draft tasks.
              </p>
            </div>
          </div>
        ) : (
          <form className="settings-form" onSubmit={submit} aria-busy={busy}>
            <SelectField
              label="Agent"
              value={profileId}
              disabled={busy}
              options={[
                { value: "", label: "No default agent" },
                ...readyProfiles.map((profile) => ({ value: profile.profileId, label: profile.provider })),
              ]}
              onChange={(nextId) => {
                const next = readyProfiles.find((profile) => profile.profileId === nextId);
                setProfileId(nextId);
                setModel(next?.models[0] ?? "");
                setEffort(next?.efforts[0] ?? "");
              }}
            />

            <SelectField
              label="Model"
              value={model}
              disabled={busy || selected === null}
              options={(selected?.models ?? []).map((value) => ({ value, label: value }))}
              onChange={setModel}
            />

            <SelectField
              label="Effort"
              value={effort}
              disabled={busy || selected === null}
              options={(selected?.efforts ?? []).map((value) => ({ value, label: value }))}
              onChange={setEffort}
            />

            <Button type="submit" isDisabled={busy} isPending={busy}>Save task defaults</Button>
          </form>
        )}
      </Card.Content>
    </Card>
  );
}
