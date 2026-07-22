import { useState, type FormEvent } from "react";
import type {
  FutureCardProfileDefaults,
  SettingsProfileProjection,
} from "../../shared/desktopRpc.ts";
import type { ProfileId } from "@kitten/engine";

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
    <section className="settings-panel" aria-labelledby="profile-defaults-title">
      <h2 id="profile-defaults-title">Future-card profile default</h2>
      <p>
        This seeds new cards only. Existing card configuration and recorded Run Contexts stay unchanged.
      </p>

      <ul className="profile-readiness-list" aria-label="Certified profile readiness">
        {profiles.length === 0 ? <li>No certified profiles are available.</li> : profiles.map((profile) => (
          <li key={profile.profileId}>
            <strong>{profile.provider}</strong>{" "}
            {profile.readiness.ready
              ? `Ready (protocol ${profile.readiness.protocolVersion})`
              : `Unavailable: ${profile.readiness.message}`}
          </li>
        ))}
      </ul>

      <form className="settings-form" onSubmit={submit} aria-busy={busy}>
        <label className="field">
          <span>Default profile for future cards</span>
          <select
            value={profileId}
            disabled={busy}
            onChange={(event) => {
              const nextId = event.currentTarget.value;
              const next = profiles.find((profile) => profile.profileId === nextId);
              setProfileId(nextId);
              setModel(next?.models[0] ?? "");
              setEffort(next?.efforts[0] ?? "");
            }}
          >
            <option value="">No default profile</option>
            {profiles.map((profile) => (
              <option key={profile.profileId} value={profile.profileId} disabled={!profile.readiness.ready}>
                {profile.provider}{profile.readiness.ready ? "" : " — unavailable"}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Default model for future cards</span>
          <select
            value={model}
            disabled={busy || selected === null || !selected.readiness.ready}
            onChange={(event) => setModel(event.currentTarget.value)}
          >
            {(selected?.models ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>

        <label className="field">
          <span>Default effort for future cards</span>
          <select
            value={effort}
            disabled={busy || selected === null || !selected.readiness.ready}
            onChange={(event) => setEffort(event.currentTarget.value)}
          >
            {(selected?.efforts ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>

        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? "Saving profile default…" : "Save profile default"}
        </button>
      </form>
    </section>
  );
}
