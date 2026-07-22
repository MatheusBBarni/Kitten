import { useState, type FormEvent } from "react";
import { Button, Card, Chip } from "@heroui/react";
import type {
  FutureCardProfileDefaults,
  SettingsProfileProjection,
} from "../../shared/desktopRpc.ts";
import type { ProfileId } from "@kitten/engine";
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
  const [profileId, setProfileId] = useState<string>(defaults.profileId ?? "");
  const selected = profiles.find((profile) => profile.profileId === profileId) ?? null;
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
        <Card.Title id="profile-defaults-title">Future-card profile default</Card.Title>
        <Card.Description>
        This seeds new cards only. Existing card configuration and recorded Run Contexts stay unchanged.
        </Card.Description>
        </div>
      </Card.Header>
      <Card.Content className="grid gap-4">

      <ul className="profile-readiness-list" aria-label="Certified profile readiness">
        {profiles.length === 0 ? <li>No certified profiles are available.</li> : profiles.map((profile) => (
          <li key={profile.profileId}>
            <strong>{profile.provider}</strong>{" "}
            <Chip size="sm" variant="soft" color={profile.readiness.ready ? "success" : "danger"}>
              {profile.readiness.ready ? `Ready · protocol ${profile.readiness.protocolVersion}` : "Unavailable"}
            </Chip>
            {profile.readiness.ready ? null : <span className="ml-2 text-muted">{profile.readiness.message}</span>}
          </li>
        ))}
      </ul>

      <form className="settings-form" onSubmit={submit} aria-busy={busy}>
        <SelectField
          label="Default profile for future cards"
          value={profileId}
          disabled={busy}
          options={[
            { value: "", label: "No default profile" },
            ...profiles.map((profile) => ({
              value: profile.profileId,
              label: `${profile.provider}${profile.readiness.ready ? "" : " — unavailable"}`,
              disabled: !profile.readiness.ready,
            })),
          ]}
          onChange={(nextId) => {
              const next = profiles.find((profile) => profile.profileId === nextId);
              setProfileId(nextId);
              setModel(next?.models[0] ?? "");
              setEffort(next?.efforts[0] ?? "");
          }}
        />

        <SelectField
          label="Default model for future cards"
          value={model}
          disabled={busy || selected === null || !selected.readiness.ready}
          options={(selected?.models ?? []).map((value) => ({ value, label: value }))}
          onChange={setModel}
        />

        <SelectField
          label="Default effort for future cards"
          value={effort}
          disabled={busy || selected === null || !selected.readiness.ready}
          options={(selected?.efforts ?? []).map((value) => ({ value, label: value }))}
          onChange={setEffort}
        />

        <Button type="submit" isDisabled={busy} isPending={busy}>Save profile default</Button>
      </form>
      </Card.Content>
    </Card>
  );
}
