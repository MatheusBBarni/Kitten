import { describe, expect, test } from "bun:test";
import type { ProfileId } from "@kitten/engine";
import type { CertifiedDirectAcpProfile } from "../src/attempts/contracts.ts";
import type { SkillCatalog } from "../src/catalog/contracts.ts";
import { createAttentionFixture } from "../src/attention/testSupport.ts";
import { createDesktopSettingsRpc } from "../src/host/settingsRpc.ts";
import {
  startDesktopShell,
  type DesktopWindowFactory,
} from "../src/main.ts";
import type { HostMessageEnvelope } from "../src/shared/rpc.ts";

const PROFILE_ID = "profile-codex" as ProfileId;
const profile: CertifiedDirectAcpProfile = {
  profileId: PROFILE_ID,
  provider: "Codex",
  models: ["gpt-5", "gpt-5-mini"],
  efforts: ["medium", "high"],
  readiness: { profileId: PROFILE_ID, ready: true, protocolVersion: 1 },
  certification: { recipeId: "codex-acp", adapterVersion: "1.0.0", checkedAt: 10 },
};

function projectedCatalog(input: { readonly projectRoots: readonly string[]; readonly userRoots: readonly string[] }): SkillCatalog {
  const roots = [
    ...input.projectRoots.map((configuredPath, order) => ({
      rootClass: "project" as const,
      configuredPath,
      canonicalPath: `${configuredPath}/canonical`,
      order,
      valid: true,
      diagnostics: [],
    })),
    ...input.userRoots.map((configuredPath, index) => ({
      rootClass: "user" as const,
      configuredPath,
      canonicalPath: `${configuredPath}/canonical`,
      order: input.projectRoots.length + index,
      valid: true,
      diagnostics: [],
    })),
  ];
  return Object.freeze({ roots, entries: [], diagnostics: [], resolvedSkills: new Map() });
}

class FakeSettingsWindowFactory implements DesktopWindowFactory {
  handlers?: Parameters<DesktopWindowFactory["open"]>[0];
  readonly messages: HostMessageEnvelope[] = [];

  open(handlers: Parameters<DesktopWindowFactory["open"]>[0]) {
    this.handlers = handlers;
    return {
      sendHostMessage: (message: HostMessageEnvelope) => this.messages.push(message),
      removeHandlers: () => { this.handlers = undefined; },
      close() {},
    };
  }
}

describe("settings RPC integration", () => {
  test("applies every typed mutation, returns stale conflicts, and preserves immutable history", async () => {
    const history = createAttentionFixture();
    const before = history.journal.snapshot();
    const immutableBefore = JSON.stringify({
      cards: before.cards,
      attempts: before.attempts,
      runContexts: before.runContexts,
      events: history.journal.events(),
    });
    const settingsRpc = createDesktopSettingsRpc({
      profiles: [profile],
      discoverCatalog: projectedCatalog,
    });
    const factory = new FakeSettingsWindowFactory();
    const shell = startDesktopShell({ windowFactory: factory, settingsRpc });
    const handlers = factory.handlers!;

    const fresh = await handlers.onGetSettings({});
    expect(fresh.result).toMatchObject({
      status: "ok",
      projection: { revision: 0, scheduler: { automaticExecutionLimit: 1 } },
    });

    const theme = await handlers.onUpdatePreferences({
      commandId: "settings-theme",
      input: { expectedRevision: 0, theme: "dark" },
    });
    const defaults = await handlers.onUpdateProfileDefaults({
      commandId: "settings-defaults",
      input: { expectedRevision: 1, profileId: PROFILE_ID, model: "gpt-5", effort: "high" },
    });
    const roots = await handlers.onUpdateCatalogRoots({
      commandId: "settings-roots",
      input: { expectedRevision: 2, projectRoots: ["/repo/.agents/skills"], userRoots: ["/user/skills"] },
    });
    const limit = await handlers.onSetExecutionLimit({
      commandId: "settings-limit",
      input: { expectedRevision: 3, limit: 3 },
    });

    expect(theme.result).toMatchObject({ status: "ok", changedSections: ["preferences"] });
    expect(defaults.result).toMatchObject({
      status: "ok",
      changedSections: ["profile_defaults"],
      projection: { profileDefaults: { profileId: PROFILE_ID, model: "gpt-5", effort: "high", appliesTo: "future_cards" } },
    });
    expect(roots.result).toMatchObject({
      status: "ok",
      changedSections: ["catalog_roots"],
      projection: { catalog: { roots: [{ rootClass: "project" }, { rootClass: "user" }] } },
    });
    expect(limit.result).toMatchObject({
      status: "ok",
      changedSections: ["execution_limit"],
      projection: { revision: 4, scheduler: { automaticExecutionLimit: 3 } },
    });
    expect(settingsRpc.defaultsForNewCard()).toEqual({
      profileId: PROFILE_ID,
      model: "gpt-5",
      effort: "high",
      appliesTo: "future_cards",
    });

    const stale = await handlers.onSetExecutionLimit({
      commandId: "settings-stale",
      input: { expectedRevision: 2, limit: 8 },
    });
    expect(stale.result).toEqual({
      status: "conflict",
      conflict: { kind: "stale_settings", expectedRevision: 2, actualRevision: 4 },
    });
    const committed = await handlers.onGetSettings({ knownRevision: 2 });
    expect(committed.result).toMatchObject({
      status: "ok",
      projection: { revision: 4, preferences: { theme: "dark" }, scheduler: { automaticExecutionLimit: 3 } },
    });
    expect(factory.messages.map(({ kind }) => kind)).toEqual([
      "settings_committed",
      "settings_committed",
      "settings_committed",
      "settings_committed",
    ]);

    const after = history.journal.snapshot();
    expect(JSON.stringify({
      cards: after.cards,
      attempts: after.attempts,
      runContexts: after.runContexts,
      events: history.journal.events(),
    })).toBe(immutableBefore);

    shell.stop();
    history.database.close();
  });

  test("content-minimizes host exceptions and exposes the stopped-host state", async () => {
    let discoveryCalls = 0;
    const settingsRpc = createDesktopSettingsRpc({
      discoverCatalog(input) {
        discoveryCalls += 1;
        if (discoveryCalls > 1) throw new Error("secret repository path and prompt");
        return projectedCatalog(input);
      },
    });
    const factory = new FakeSettingsWindowFactory();
    startDesktopShell({ windowFactory: factory, settingsRpc });
    const failed = await factory.handlers!.onUpdateCatalogRoots({
      commandId: "settings-host-error",
      input: { expectedRevision: 0, projectRoots: ["/secret"], userRoots: [] },
    });
    expect(failed).toEqual({
      kind: "settings_command_result",
      commandId: "settings-host-error",
      result: {
        status: "unavailable",
        unavailable: { resource: "settings_command", reason: "projection_rejected" },
      },
    });
    expect(JSON.stringify(failed)).not.toContain("secret repository path and prompt");

    const safeFactory = new FakeSettingsWindowFactory();
    const shell = startDesktopShell({ windowFactory: safeFactory });
    const getSettings = safeFactory.handlers!.onGetSettings;
    shell.stop();
    expect(await getSettings({})).toEqual({
      kind: "desktop_settings",
      result: {
        status: "unavailable",
        unavailable: { resource: "desktop_host", reason: "host_stopped" },
      },
    });
  });
});
