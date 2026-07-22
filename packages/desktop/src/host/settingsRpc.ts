import type { ProfileId } from "@kitten/engine";
import type { CertifiedDirectAcpProfile } from "../attempts/contracts.ts";
import { createGlobalAttemptScheduler, type GlobalAttemptScheduler } from "../attempts/scheduler.ts";
import { discoverSkillCatalog } from "../catalog/skillCatalog.ts";
import type { DiscoverSkillCatalogInput, SkillCatalog } from "../catalog/contracts.ts";
import {
  createSettingsCommandEnvelope,
  createSettingsEnvelope,
} from "../shared/rpc.ts";
import type {
  DesktopSettingsProjection,
  DesktopSettingsRpc,
  FutureCardProfileDefaults,
  SettingsCommandEnvelope,
  SettingsCommandRequest,
  SettingsCommandResult,
  SettingsProfileProjection,
  SettingsSection,
  SettingsTheme,
  SetExecutionLimitInput,
  UpdateCatalogRootsInput,
  UpdatePreferencesInput,
  UpdateProfileDefaultsInput,
} from "../shared/desktopRpc.ts";

export interface CreateDesktopSettingsRpcOptions {
  readonly catalogId?: string;
  readonly scheduler?: GlobalAttemptScheduler;
  readonly profiles?: readonly CertifiedDirectAcpProfile[];
  readonly initialTheme?: SettingsTheme;
  readonly initialProfileDefaults?: Omit<FutureCardProfileDefaults, "appliesTo">;
  readonly initialProjectRoots?: readonly string[];
  readonly initialUserRoots?: readonly string[];
  readonly discoverCatalog?: (input: DiscoverSkillCatalogInput) => SkillCatalog;
}

const FUTURE_CARD_DEFAULTS: FutureCardProfileDefaults = Object.freeze({
  profileId: null,
  model: null,
  effort: null,
  appliesTo: "future_cards",
});

function profileProjection(profile: CertifiedDirectAcpProfile): SettingsProfileProjection {
  return {
    profileId: profile.profileId,
    provider: profile.provider,
    models: [...profile.models],
    efforts: [...profile.efforts],
    readiness: profile.readiness.ready
      ? { ready: true, protocolVersion: profile.readiness.protocolVersion }
      : {
          ready: false,
          reason: profile.readiness.reason,
          message: profile.readiness.message,
        },
  };
}

function validRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function createDesktopSettingsRpc(
  options: CreateDesktopSettingsRpcOptions = {},
): DesktopSettingsRpc & { readonly scheduler: GlobalAttemptScheduler; defaultsForNewCard(): FutureCardProfileDefaults } {
  const scheduler = options.scheduler ?? createGlobalAttemptScheduler();
  const profiles = [...(options.profiles ?? [])];
  const discoverCatalog = options.discoverCatalog ?? discoverSkillCatalog;
  const catalogId = options.catalogId ?? "default";
  let revision = 0;
  let theme: SettingsTheme = options.initialTheme ?? "system";
  let profileDefaults: FutureCardProfileDefaults = {
    ...(options.initialProfileDefaults ?? FUTURE_CARD_DEFAULTS),
    appliesTo: "future_cards",
  };
  let projectRoots = [...(options.initialProjectRoots ?? [])];
  let userRoots = [...(options.initialUserRoots ?? [])];
  let catalog = discoverCatalog({ projectRoots, userRoots });

  const projection = (): DesktopSettingsProjection => ({
    kind: "desktop_settings_projection",
    revision,
    preferences: { theme },
    profileDefaults: { ...profileDefaults },
    profiles: profiles.map(profileProjection),
    catalog: {
      catalogId,
      roots: catalog.roots,
      entries: catalog.entries,
      diagnostics: catalog.diagnostics,
    },
    scheduler: {
      automaticExecutionLimit: scheduler.limit,
      activeCount: scheduler.activeCount,
    },
    historyPolicy: "future_cards_only",
  });

  const run = <Input>(
    request: SettingsCommandRequest<Input>,
    apply: (input: Input) => { readonly changed: boolean; readonly sections: readonly SettingsSection[] } | SettingsCommandResult,
  ): SettingsCommandEnvelope => {
    if (request.commandId.trim().length === 0) throw new Error("Settings commandId must be non-empty");
    const input = request.input as Input & { readonly expectedRevision: number };
    if (!validRevision(input.expectedRevision)) {
      return createSettingsCommandEnvelope(request.commandId, {
        status: "rejected",
        rejection: {
          code: "invalid_settings_revision",
          message: "Settings revision must be a non-negative whole number.",
        },
      });
    }
    if (input.expectedRevision !== revision) {
      return createSettingsCommandEnvelope(request.commandId, {
        status: "conflict",
        conflict: {
          kind: "stale_settings",
          expectedRevision: input.expectedRevision,
          actualRevision: revision,
        },
      });
    }
    const result = apply(request.input);
    if ("status" in result) return createSettingsCommandEnvelope(request.commandId, result);
    if (result.changed) revision += 1;
    return createSettingsCommandEnvelope(request.commandId, {
      status: "ok",
      projection: projection(),
      changedSections: result.changed ? result.sections : [],
    });
  };

  return {
    scheduler,
    defaultsForNewCard() {
      return Object.freeze({ ...profileDefaults });
    },
    async getSettings() {
      return createSettingsEnvelope({ status: "ok", projection: projection() });
    },
    async updatePreferences(request) {
      return run<UpdatePreferencesInput>(request, (input) => {
        if (input.theme !== "system" && input.theme !== "light" && input.theme !== "dark") {
          return {
            status: "rejected",
            rejection: { code: "invalid_theme", message: "Choose System, Light, or Dark theme." },
          };
        }
        const changed = theme !== input.theme;
        theme = input.theme;
        return { changed, sections: ["preferences"] };
      });
    },
    async updateProfileDefaults(request) {
      return run<UpdateProfileDefaultsInput>(request, (input) => {
        if (input.profileId === null) {
          if (input.model !== null || input.effort !== null) {
            return {
              status: "rejected",
              rejection: {
                code: "invalid_profile_default",
                message: "Clear model and effort when no future-card profile is selected.",
              },
            };
          }
        } else {
          const profile = profiles.find(({ profileId }) => profileId === input.profileId);
          if (profile === undefined || !profile.readiness.ready) {
            return {
              status: "rejected",
              rejection: {
                code: "invalid_profile_default",
                message: "Choose a ready certified profile for future cards.",
              },
            };
          }
          if (
            input.model === null
            || input.effort === null
            || !profile.models.includes(input.model)
            || !profile.efforts.includes(input.effort)
          ) {
            return {
              status: "rejected",
              rejection: {
                code: "invalid_profile_default",
                message: "Choose a model and effort supported by the selected profile.",
              },
            };
          }
        }
        const changed = profileDefaults.profileId !== input.profileId
          || profileDefaults.model !== input.model
          || profileDefaults.effort !== input.effort;
        profileDefaults = {
          profileId: input.profileId,
          model: input.model,
          effort: input.effort,
          appliesTo: "future_cards",
        };
        return { changed, sections: ["profile_defaults"] };
      });
    },
    async updateCatalogRoots(request) {
      return run<UpdateCatalogRootsInput>(request, (input) => {
        const normalizedProject = input.projectRoots.map((root) => root.trim());
        const normalizedUser = input.userRoots.map((root) => root.trim());
        if ([...normalizedProject, ...normalizedUser].some((root) => root.length === 0)) {
          return {
            status: "rejected",
            rejection: {
              code: "invalid_catalog_root",
              message: "Catalog root paths must not be blank.",
            },
          };
        }
        const changed = !sameStrings(projectRoots, normalizedProject)
          || !sameStrings(userRoots, normalizedUser);
        if (changed) {
          const discovered = discoverCatalog({
            projectRoots: normalizedProject,
            userRoots: normalizedUser,
          });
          projectRoots = normalizedProject;
          userRoots = normalizedUser;
          catalog = discovered;
        }
        return { changed, sections: ["catalog_roots"] };
      });
    },
    async setExecutionLimit(request) {
      return run<SetExecutionLimitInput>(request, (input) => {
        if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
          return {
            status: "rejected",
            rejection: {
              code: "invalid_execution_limit",
              message: "Automatic execution limit must be a positive whole number.",
            },
          };
        }
        const changed = scheduler.limit !== input.limit;
        if (changed) scheduler.setLimit(input.limit);
        return { changed, sections: ["execution_limit"] };
      });
    },
  };
}
