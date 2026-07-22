import { afterEach, describe, expect, test } from "bun:test";
import type { ProfileId } from "@kitten/engine";
import "./testDom.ts";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import type { DesktopRpcClient } from "../client.ts";
import { createDesktopQueryClient } from "../query/desktopQueries.ts";
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
  const { acpProviders = [], ...remainingOverrides } = overrides;
  return {
    kind: "desktop_settings_projection",
    revision: 0,
    preferences: { theme: "system" },
    profileDefaults: { profileId: null, model: null, effort: null, appliesTo: "future_cards" },
    acpProviders,
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
    ...remainingOverrides,
  };
}

function unused(): never {
  throw new Error("not used");
}

function renderSettings(client: DesktopRpcClient) {
  const queryClient = createDesktopQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsView client={client} />
    </QueryClientProvider>,
  );
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

    const choose = async (label: string, option: string) => {
      await user.click(view.getByRole("button", { name: new RegExp(label) }));
      await user.click(await view.findByRole("option", { name: option }));
      await user.keyboard("{Escape}");
    };
    await choose("Agent", "Codex");
    await choose("Model", "gpt-5-mini");
    await choose("Effort", "high");
    fireEvent.submit(view.getByRole("button", { name: "Save task defaults" }).closest("form")!);
    expect(saves[0]).toEqual({ profileId: PROFILE_ID, model: "gpt-5-mini", effort: "high" });

    await user.type(view.getByLabelText("Project roots"), " /repo/a {enter}{enter}/repo/b");
    await user.type(view.getByLabelText("User roots"), "/user/a");
    fireEvent.submit(view.getByRole("button", { name: "Save and scan roots" }).closest("form")!);
    expect(saves[1]).toEqual({ projectRoots: ["/repo/a", "/repo/b"], userRoots: ["/user/a"] });

    view.rerender(<ExecutionLimitPanel limit={1} activeCount={0} busy={false} onSave={(value) => saves.push(value)} />);
    const input = view.getByLabelText("Automatically active cards");
    await user.click(input);
    await user.keyboard("{Backspace}0");
    fireEvent.submit(view.getByRole("button", { name: "Save execution limit" }).closest("form")!);
    expect(view.getByText(/The value was not changed/).textContent).toContain("The value was not changed");
    expect(saves).toHaveLength(2);
    await user.keyboard("{Backspace}3");
    fireEvent.submit(view.getByRole("button", { name: "Save execution limit" }).closest("form")!);
    expect(saves[2]).toBe(3);
  });

  test("reconciles successful commands and exposes conflict, rejection, and unavailable feedback", async () => {
    const fake = fakeClient();
    const user = userEvent.setup();
    const view = renderSettings(fake.client);
    await view.findByText("Revision 0");

    const choose = async (label: string, option: string) => {
      await user.click(view.getByRole("button", { name: new RegExp(label) }));
      await user.click(await view.findByRole("option", { name: option }));
      await user.keyboard("{Escape}");
    };
    await choose("Theme", "Dark");
    await view.findByText("Theme preference saved.");
    expect(fake.calls[0]).toMatchObject({ method: "preferences", input: { expectedRevision: 0, theme: "dark" } });

    await choose("Agent", "Codex");
    fireEvent.submit(view.getByRole("button", { name: "Save task defaults" }).closest("form")!);
    await view.findByText("Task defaults saved.");
    expect(fake.calls.some(({ method }) => method === "profile")).toBeTrue();

    await user.type(view.getByLabelText("Project roots"), "/repo/skills");
    fireEvent.submit(view.getByRole("button", { name: "Save and scan roots" }).closest("form")!);
    await view.findByText("Catalog roots saved and scanned.");
    expect(fake.calls.some(({ method }) => method === "catalog")).toBeTrue();

    fireEvent.input(view.getByLabelText("Automatically active cards"), { target: { value: "2" } });
    fireEvent.submit(view.getByRole("button", { name: "Save execution limit" }).closest("form")!);
    await view.findByText("Automatic execution limit saved.");
    expect(fake.calls.some(({ method }) => method === "limit")).toBeTrue();

    fake.setCommandResult({
      status: "conflict",
      conflict: { kind: "stale_settings", expectedRevision: 0, actualRevision: 2 },
    });
    await choose("Theme", "Light");
    await view.findByText(/Expected revision 0, now 2/);

    fake.setCommandResult({ status: "rejected", rejection: { code: "invalid_theme", message: "Theme rejected." } });
    await choose("Theme", "System");
    await view.findByText("Theme rejected.");

    fake.setCommandResult({
      status: "unavailable",
      unavailable: { resource: "settings_command", reason: "projection_rejected" },
    });
    await choose("Theme", "Light");
    await view.findByText(/Settings are unavailable from the desktop host/);

    fake.setCommandResult(null);
    fake.failNextCommand();
    await choose("Theme", "System");
    await waitFor(() => expect(view.container.textContent).not.toContain("host details must not reach the renderer"));
  });

  test("retries an unavailable initial projection", async () => {
    const fake = fakeClient();
    fake.setGetSettingsUnavailable(true);
    const view = renderSettings(fake.client);
    await view.findByText("Settings unavailable");
    fake.setGetSettingsUnavailable(false);
    fireEvent.click(view.getByRole("button", { name: "Retry settings" }));
    await view.findByText("Revision 0");
  });
});
