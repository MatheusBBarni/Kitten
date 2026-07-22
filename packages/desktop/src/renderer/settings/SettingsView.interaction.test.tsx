import { afterEach, describe, expect, test } from "bun:test";
import type { ProfileId } from "@kitten/engine";
import "./testDom.ts";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DesktopRpcClient } from "../client.ts";
import type {
  DesktopSettingsProjection,
  SettingsCommandResult,
  UpdateCatalogRootsInput,
  UpdatePreferencesInput,
  UpdateProfileDefaultsInput,
} from "../../shared/desktopRpc.ts";
import { createSettingsCommandEnvelope, createSettingsEnvelope } from "../../shared/rpc.ts";
import { CatalogRootsPanel } from "./CatalogRootsPanel.tsx";
import { ExecutionLimitPanel } from "./ExecutionLimitPanel.tsx";
import { ProfileDefaultsPanel } from "./ProfileDefaultsPanel.tsx";
import { SettingsView } from "./SettingsView.tsx";

afterEach(cleanup);

const PROFILE_ID = "profile-codex" as ProfileId;

function projection(overrides: Partial<DesktopSettingsProjection> = {}): DesktopSettingsProjection {
  return {
    kind: "desktop_settings_projection",
    revision: 0,
    preferences: { theme: "system" },
    profileDefaults: { profileId: null, model: null, effort: null, appliesTo: "future_cards" },
    profiles: [{
      profileId: PROFILE_ID,
      provider: "Codex",
      models: ["gpt-5", "gpt-5-mini"],
      efforts: ["medium", "high"],
      readiness: { ready: true, protocolVersion: 1 },
    }],
    catalog: { catalogId: "default", roots: [], entries: [], diagnostics: [] },
    scheduler: { automaticExecutionLimit: 1, activeCount: 0 },
    historyPolicy: "future_cards_only",
    ...overrides,
  };
}

function unused(): never {
  throw new Error("not used");
}

function fakeClient(initial = projection()) {
  let current = initial;
  let getSettingsUnavailable = false;
  let commandResult: SettingsCommandResult | null = null;
  let throwNextCommand = false;
  const calls: Array<{ readonly method: string; readonly input: unknown }> = [];

  function result(commandId: string, next: DesktopSettingsProjection) {
    if (throwNextCommand) {
      throwNextCommand = false;
      throw new Error("host details must not reach the renderer");
    }
    const selected = commandResult ?? { status: "ok" as const, projection: next, changedSections: [] };
    if (selected.status === "ok") current = selected.projection;
    return createSettingsCommandEnvelope(commandId, selected);
  }

  const client: DesktopRpcClient = {
    async getSettings() {
      return getSettingsUnavailable
        ? createSettingsEnvelope({ status: "unavailable", unavailable: { resource: "desktop_settings", reason: "not_ready" } })
        : createSettingsEnvelope({ status: "ok", projection: current });
    },
    async updatePreferences(commandId: string, input: UpdatePreferencesInput) {
      calls.push({ method: "preferences", input });
      return result(commandId, projection({ ...current, revision: current.revision + 1, preferences: { theme: input.theme } }));
    },
    async updateProfileDefaults(commandId: string, input: UpdateProfileDefaultsInput) {
      calls.push({ method: "profile", input });
      return result(commandId, projection({
        ...current,
        revision: current.revision + 1,
        profileDefaults: { profileId: input.profileId, model: input.model, effort: input.effort, appliesTo: "future_cards" },
      }));
    },
    async updateCatalogRoots(commandId: string, input: UpdateCatalogRootsInput) {
      calls.push({ method: "catalog", input });
      return result(commandId, projection({ ...current, revision: current.revision + 1 }));
    },
    async setExecutionLimit(commandId, input) {
      calls.push({ method: "limit", input });
      return result(commandId, projection({
        ...current,
        revision: current.revision + 1,
        scheduler: { ...current.scheduler, automaticExecutionLimit: input.limit },
      }));
    },
    subscribe() { return () => {}; },
    async getDesktopSnapshot() { return unused(); },
    async getCardInspector() { return unused(); },
    async getBoard() { return unused(); },
    async getCatalog() { return unused(); },
    async executeWorkflowCommand() { return unused(); },
    async startAttempt() { return unused(); },
    async queueFollowUp() { return unused(); },
    async removeQueuedFollowUp() { return unused(); },
    async confirmQueuedFollowUp() { return unused(); },
    async answerAttention() { return unused(); },
    dispose() {},
  };

  return {
    client,
    calls,
    setCommandResult(next: SettingsCommandResult | null) { commandResult = next; },
    setGetSettingsUnavailable(next: boolean) { getSettingsUnavailable = next; },
    failNextCommand() { throwNextCommand = true; },
  };
}

describe("settings renderer interactions", () => {
  test("submits profile, root, and validated execution-limit edits through labeled forms", async () => {
    const saves: unknown[] = [];
    const user = userEvent.setup();
    const view = render(
      <>
        <ProfileDefaultsPanel
          profiles={projection().profiles}
          defaults={projection().profileDefaults}
          busy={false}
          onSave={(value) => saves.push(value)}
        />
        <CatalogRootsPanel catalog={projection().catalog} busy={false} onSave={(value) => saves.push(value)} />
        <ExecutionLimitPanel limit={1} activeCount={0} busy={false} onSave={(value) => saves.push(value)} />
      </>,
    );

    fireEvent.change(view.getByLabelText("Default profile for future cards"), { target: { value: PROFILE_ID } });
    fireEvent.change(view.getByLabelText("Default model for future cards"), { target: { value: "gpt-5-mini" } });
    fireEvent.change(view.getByLabelText("Default effort for future cards"), { target: { value: "high" } });
    fireEvent.submit(view.getByRole("button", { name: "Save profile default" }).closest("form")!);
    expect(saves[0]).toEqual({ profileId: PROFILE_ID, model: "gpt-5-mini", effort: "high" });

    await user.type(view.getByLabelText("Project roots"), " /repo/a {enter}{enter}/repo/b");
    await user.type(view.getByLabelText("User roots"), "/user/a");
    fireEvent.submit(view.getByRole("button", { name: "Save and scan roots" }).closest("form")!);
    expect(saves[1]).toEqual({ projectRoots: ["/repo/a", "/repo/b"], userRoots: ["/user/a"] });

    const input = view.getByLabelText("Automatically active cards");
    await user.clear(input);
    await user.type(input, "0");
    fireEvent.submit(view.getByRole("button", { name: "Save execution limit" }).closest("form")!);
    expect(view.getByRole("alert").textContent).toContain("The value was not changed");
    expect(saves).toHaveLength(2);
    await user.clear(input);
    await user.type(input, "3");
    fireEvent.submit(view.getByRole("button", { name: "Save execution limit" }).closest("form")!);
    expect(saves[2]).toBe(3);
  });

  test("reconciles successful commands and exposes conflict, rejection, and unavailable feedback", async () => {
    const fake = fakeClient();
    const user = userEvent.setup();
    const view = render(<SettingsView client={fake.client} />);
    await view.findByText("Settings revision 0");

    const theme = () => view.getByLabelText("Theme");
    fireEvent.change(theme(), { target: { value: "dark" } });
    await view.findByText("Theme preference saved.");
    expect(fake.calls[0]).toMatchObject({ method: "preferences", input: { expectedRevision: 0, theme: "dark" } });

    fireEvent.change(view.getByLabelText("Default profile for future cards"), { target: { value: PROFILE_ID } });
    fireEvent.submit(view.getByRole("button", { name: "Save profile default" }).closest("form")!);
    await view.findByText("Future-card profile default saved.");
    expect(fake.calls.some(({ method }) => method === "profile")).toBeTrue();

    await user.type(view.getByLabelText("Project roots"), "/repo/skills");
    fireEvent.submit(view.getByRole("button", { name: "Save and scan roots" }).closest("form")!);
    await view.findByText("Catalog roots saved and scanned.");
    expect(fake.calls.some(({ method }) => method === "catalog")).toBeTrue();

    await user.clear(view.getByLabelText("Automatically active cards"));
    await user.type(view.getByLabelText("Automatically active cards"), "2");
    fireEvent.submit(view.getByRole("button", { name: "Save execution limit" }).closest("form")!);
    await view.findByText("Automatic execution limit saved.");
    expect(fake.calls.some(({ method }) => method === "limit")).toBeTrue();

    fake.setCommandResult({
      status: "conflict",
      conflict: { kind: "stale_settings", expectedRevision: 0, actualRevision: 2 },
    });
    fireEvent.change(theme(), { target: { value: "light" } });
    await view.findByText(/Expected revision 0, now 2/);

    fake.setCommandResult({ status: "rejected", rejection: { code: "invalid_theme", message: "Theme rejected." } });
    fireEvent.change(theme(), { target: { value: "system" } });
    await view.findByText("Theme rejected.");

    fake.setCommandResult({
      status: "unavailable",
      unavailable: { resource: "settings_command", reason: "projection_rejected" },
    });
    fireEvent.change(theme(), { target: { value: "dark" } });
    await view.findByText(/Settings are unavailable from the desktop host/);

    fake.setCommandResult(null);
    fake.failNextCommand();
    fireEvent.change(theme(), { target: { value: "light" } });
    await waitFor(() => expect(view.container.textContent).not.toContain("host details must not reach the renderer"));
  });

  test("retries an unavailable initial projection", async () => {
    const fake = fakeClient();
    fake.setGetSettingsUnavailable(true);
    const view = render(<SettingsView client={fake.client} />);
    await view.findByText("Settings unavailable");
    fake.setGetSettingsUnavailable(false);
    fireEvent.click(view.getByRole("button", { name: "Retry settings" }));
    await view.findByText("Settings revision 0");
  });
});
