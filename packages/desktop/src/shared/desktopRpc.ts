import type { ProfileId, ProfileNotReadyReason } from "@kitten/engine";
import type { CatalogProjection } from "../persistence/eventJournal.ts";

export type SettingsTheme = "system" | "light" | "dark";
export type SettingsSection =
  | "preferences"
  | "profile_defaults"
  | "catalog_roots"
  | "execution_limit";

export interface SettingsProfileProjection {
  readonly profileId: ProfileId;
  readonly provider: string;
  readonly models: readonly string[];
  readonly efforts: readonly string[];
  readonly readiness:
    | { readonly ready: true; readonly protocolVersion: number }
    | {
        readonly ready: false;
        readonly reason: ProfileNotReadyReason;
        readonly message: string;
      };
}

export interface FutureCardProfileDefaults {
  readonly profileId: ProfileId | null;
  readonly model: string | null;
  readonly effort: string | null;
  readonly appliesTo: "future_cards";
}

export interface DesktopSettingsProjection {
  readonly kind: "desktop_settings_projection";
  readonly revision: number;
  readonly preferences: { readonly theme: SettingsTheme };
  readonly profileDefaults: FutureCardProfileDefaults;
  readonly profiles: readonly SettingsProfileProjection[];
  readonly catalog: CatalogProjection;
  readonly scheduler: {
    readonly automaticExecutionLimit: number;
    readonly activeCount: number;
  };
  readonly historyPolicy: "future_cards_only";
}

export interface UpdatePreferencesInput {
  readonly expectedRevision: number;
  readonly theme: SettingsTheme;
}

export interface UpdateProfileDefaultsInput {
  readonly expectedRevision: number;
  readonly profileId: ProfileId | null;
  readonly model: string | null;
  readonly effort: string | null;
}

export interface UpdateCatalogRootsInput {
  readonly expectedRevision: number;
  readonly projectRoots: readonly string[];
  readonly userRoots: readonly string[];
}

export interface SetExecutionLimitInput {
  readonly expectedRevision: number;
  readonly limit: number;
}

export interface SettingsCommandRequest<Input> {
  readonly commandId: string;
  readonly input: Input;
}

export type SettingsUnavailable = {
  readonly status: "unavailable";
  readonly unavailable: {
    readonly resource: "desktop_host" | "desktop_settings" | "settings_command";
    readonly reason: "host_stopped" | "projection_rejected" | "not_ready";
  };
};

export type SettingsQueryResult =
  | { readonly status: "ok"; readonly projection: DesktopSettingsProjection }
  | SettingsUnavailable;

export type SettingsCommandResult =
  | {
      readonly status: "ok";
      readonly projection: DesktopSettingsProjection;
      readonly changedSections: readonly SettingsSection[];
    }
  | {
      readonly status: "conflict";
      readonly conflict: {
        readonly kind: "stale_settings";
        readonly expectedRevision: number;
        readonly actualRevision: number;
      };
    }
  | {
      readonly status: "rejected";
      readonly rejection: {
        readonly code:
          | "invalid_settings_revision"
          | "invalid_theme"
          | "invalid_profile_default"
          | "invalid_catalog_root"
          | "invalid_execution_limit";
        readonly message: string;
      };
    }
  | SettingsUnavailable;

export interface SettingsEnvelope {
  readonly kind: "desktop_settings";
  readonly result: SettingsQueryResult;
}

export interface SettingsCommandEnvelope {
  readonly kind: "settings_command_result";
  readonly commandId: string;
  readonly result: SettingsCommandResult;
}

export interface DesktopSettingsRpc {
  getSettings(params?: { readonly knownRevision?: number }): Promise<SettingsEnvelope>;
  updatePreferences(request: SettingsCommandRequest<UpdatePreferencesInput>): Promise<SettingsCommandEnvelope>;
  updateProfileDefaults(request: SettingsCommandRequest<UpdateProfileDefaultsInput>): Promise<SettingsCommandEnvelope>;
  updateCatalogRoots(request: SettingsCommandRequest<UpdateCatalogRootsInput>): Promise<SettingsCommandEnvelope>;
  setExecutionLimit(request: SettingsCommandRequest<SetExecutionLimitInput>): Promise<SettingsCommandEnvelope>;
}
