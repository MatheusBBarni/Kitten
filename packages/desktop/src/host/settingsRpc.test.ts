import { describe, expect, test } from "bun:test";
import type { ProfileId } from "@kitten/engine";
import type { CertifiedDirectAcpProfile } from "../attempts/contracts.ts";
import { createGlobalAttemptScheduler } from "../attempts/scheduler.ts";
import type { DiscoverSkillCatalogInput, SkillCatalog } from "../catalog/contracts.ts";
import { createDesktopSettingsRpc } from "./settingsRpc.ts";

const READY_ID = "profile-ready" as ProfileId;
const UNREADY_ID = "profile-unready" as ProfileId;

const profiles: readonly CertifiedDirectAcpProfile[] = [
  {
    profileId: READY_ID,
    provider: "Codex",
    models: ["gpt-5"],
    efforts: ["high"],
    readiness: { profileId: READY_ID, ready: true, protocolVersion: 1 },
    certification: { recipeId: "codex-acp", adapterVersion: "1.0.0", checkedAt: 1 },
  },
  {
    profileId: UNREADY_ID,
    provider: "Claude",
    models: ["opus"],
    efforts: ["high"],
    readiness: {
      profileId: UNREADY_ID,
      ready: false,
      reason: "authentication_required",
      message: "Sign in to Claude.",
    },
    certification: { recipeId: "claude-acp", adapterVersion: "1.0.0", checkedAt: 1 },
  },
];

function emptyCatalog(): SkillCatalog {
  return Object.freeze({ roots: [], entries: [], diagnostics: [], resolvedSkills: new Map() });
}

describe("desktop settings RPC", () => {
  test("starts at one and projects ready and unavailable certified profiles without certification internals", async () => {
    const rpc = createDesktopSettingsRpc({
      profiles,
      discoverCatalog: emptyCatalog,
      acpProviders: [{
        providerId: "codex",
        displayName: "Codex",
        configuredBy: "kitten_default",
        configuredCommand: "npx",
        detectedCommands: ["codex"],
        models: ["gpt-5"],
        efforts: ["high"],
        availability: "available",
      }],
    });
    const envelope = await rpc.getSettings();
    expect(envelope.result).toMatchObject({
      status: "ok",
      projection: {
        revision: 0,
        preferences: { theme: "system" },
        scheduler: { automaticExecutionLimit: 1, activeCount: 0 },
        profileDefaults: { profileId: null, appliesTo: "future_cards" },
        profiles: [
          { profileId: READY_ID, readiness: { ready: true } },
          { profileId: UNREADY_ID, readiness: { ready: false, message: "Sign in to Claude." } },
        ],
        acpProviders: [{
          providerId: "codex",
          configuredBy: "kitten_default",
          detectedCommands: ["codex"],
          availability: "available",
        }],
        historyPolicy: "future_cards_only",
      },
    });
    expect(JSON.stringify(envelope)).not.toContain("recipeId");
    expect(JSON.stringify(envelope)).not.toContain("adapterVersion");
  });

  test("rejects invalid profile defaults, roots, themes, and execution limits without coercion", async () => {
    const rpc = createDesktopSettingsRpc({ profiles, discoverCatalog: emptyCatalog });
    const theme = await rpc.updatePreferences({
      commandId: "theme-invalid",
      input: { expectedRevision: 0, theme: "sepia" as never },
    });
    const unready = await rpc.updateProfileDefaults({
      commandId: "profile-unready",
      input: { expectedRevision: 0, profileId: UNREADY_ID, model: "opus", effort: "high" },
    });
    const roots = await rpc.updateCatalogRoots({
      commandId: "roots-invalid",
      input: { expectedRevision: 0, projectRoots: ["  "], userRoots: [] },
    });
    const limit = await rpc.setExecutionLimit({
      commandId: "limit-invalid",
      input: { expectedRevision: 0, limit: 0 },
    });
    const revision = await rpc.setExecutionLimit({
      commandId: "revision-invalid",
      input: { expectedRevision: Number.NaN, limit: 2 },
    });

    expect(theme.result).toMatchObject({ status: "rejected", rejection: { code: "invalid_theme" } });
    expect(unready.result).toMatchObject({ status: "rejected", rejection: { code: "invalid_profile_default" } });
    expect(roots.result).toMatchObject({ status: "rejected", rejection: { code: "invalid_catalog_root" } });
    expect(limit.result).toMatchObject({ status: "rejected", rejection: { code: "invalid_execution_limit" } });
    expect(revision.result).toMatchObject({ status: "rejected", rejection: { code: "invalid_settings_revision" } });
    expect((await rpc.getSettings()).result).toMatchObject({ status: "ok", projection: { revision: 0, scheduler: { automaticExecutionLimit: 1 } } });
  });

  test("changes capacity in place while preserving active reservations", async () => {
    const scheduler = createGlobalAttemptScheduler();
    const reservation = scheduler.reserve("card-active" as never);
    expect(reservation.status).toBe("reserved");
    const rpc = createDesktopSettingsRpc({ scheduler, discoverCatalog: emptyCatalog });

    const raised = await rpc.setExecutionLimit({
      commandId: "limit-two",
      input: { expectedRevision: 0, limit: 2 },
    });
    expect(raised.result).toMatchObject({
      status: "ok",
      changedSections: ["execution_limit"],
      projection: { revision: 1, scheduler: { automaticExecutionLimit: 2, activeCount: 1 } },
    });
    expect(scheduler.inspect("card-next" as never).status).toBe("available");

    const lowered = await rpc.setExecutionLimit({
      commandId: "limit-one",
      input: { expectedRevision: 1, limit: 1 },
    });
    expect(lowered.result).toMatchObject({ status: "ok", projection: { scheduler: { activeCount: 1 } } });
    expect(scheduler.inspect("card-next" as never).status).toBe("capacity_exhausted");
  });

  test("returns a typed stale conflict and leaves the committed projection intact", async () => {
    const rpc = createDesktopSettingsRpc({ discoverCatalog: emptyCatalog });
    await rpc.updatePreferences({ commandId: "theme-dark", input: { expectedRevision: 0, theme: "dark" } });
    const stale = await rpc.setExecutionLimit({ commandId: "stale", input: { expectedRevision: 0, limit: 4 } });
    expect(stale.result).toEqual({
      status: "conflict",
      conflict: { kind: "stale_settings", expectedRevision: 0, actualRevision: 1 },
    });
    expect((await rpc.getSettings()).result).toMatchObject({
      status: "ok",
      projection: { preferences: { theme: "dark" }, scheduler: { automaticExecutionLimit: 1 } },
    });
  });

  test("rescans project Skill roots after repository binding and publishes catalog changes", async () => {
    const discoveries: DiscoverSkillCatalogInput[] = [];
    const published: SkillCatalog[] = [];
    const discoverCatalog = (input: DiscoverSkillCatalogInput): SkillCatalog => {
      discoveries.push(input);
      return emptyCatalog();
    };
    const rpc = createDesktopSettingsRpc({
      initialProjectRoots: ["/repo/first/.agents/skills"],
      initialUserRoots: ["/home/name/.codex/skills"],
      discoverCatalog,
      onCatalogChanged: (catalog) => published.push(catalog),
    });

    expect(rpc.replaceProjectRoots(["/repo/second/.agents/skills"])).toBeTrue();
    expect(rpc.replaceProjectRoots(["/repo/second/.agents/skills"])).toBeFalse();
    expect(discoveries).toEqual([
      {
        projectRoots: ["/repo/first/.agents/skills"],
        userRoots: ["/home/name/.codex/skills"],
      },
      {
        projectRoots: ["/repo/second/.agents/skills"],
        userRoots: ["/home/name/.codex/skills"],
      },
    ]);
    expect(published).toHaveLength(2);
    expect((await rpc.getSettings()).result).toMatchObject({
      status: "ok",
      projection: { revision: 1 },
    });
  });
});
