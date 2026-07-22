import { describe, expect, test } from "bun:test";
import type { HostMessageEnvelope, SettingsEnvelope } from "../../shared/rpc.ts";
import { createSettingsEnvelope } from "../../shared/rpc.ts";
import type { DesktopRpcClient } from "../client.ts";
import { bindSettingsQuery } from "./settingsQueries.ts";

function fakeClient() {
  let subscriber: ((message: HostMessageEnvelope) => void) | undefined;
  let requests = 0;
  const client: DesktopRpcClient = {
    async getSettings() {
      requests += 1;
      return createSettingsEnvelope({
        status: "unavailable",
        unavailable: { resource: "desktop_settings", reason: "not_ready" },
      });
    },
    subscribe(listener) { subscriber = listener; return () => { subscriber = undefined; }; },
    async getDesktopSnapshot() { throw new Error("not used"); },
    async getCardInspector() { throw new Error("not used"); },
    async getBoard() { throw new Error("not used"); },
    async getCatalog() { throw new Error("not used"); },
    async executeWorkflowCommand() { throw new Error("not used"); },
    async startAttempt() { throw new Error("not used"); },
    async queueFollowUp() { throw new Error("not used"); },
    async removeQueuedFollowUp() { throw new Error("not used"); },
    async confirmQueuedFollowUp() { throw new Error("not used"); },
    async answerAttention() { throw new Error("not used"); },
    async updatePreferences() { throw new Error("not used"); },
    async updateProfileDefaults() { throw new Error("not used"); },
    async updateCatalogRoots() { throw new Error("not used"); },
    async setExecutionLimit() { throw new Error("not used"); },
    dispose() {},
  };
  return {
    client,
    emit(message: HostMessageEnvelope) { subscriber?.(message); },
    requests: () => requests,
  };
}

describe("settings query binding", () => {
  test("refreshes only for settings commits and host availability changes", async () => {
    const fake = fakeClient();
    const envelopes: SettingsEnvelope[] = [];
    const binding = bindSettingsQuery(fake.client, (envelope) => envelopes.push(envelope));
    await binding.ready;
    fake.emit({ kind: "projection_committed", messageId: "board", revision: 3 });
    fake.emit({
      kind: "attempt_activity",
      messageId: "activity",
      revision: 3,
      boardId: "board" as never,
      cardId: "card" as never,
      attemptId: "attempt" as never,
      generation: 1 as never,
      sequence: 1 as never,
      projection: {} as never,
    });
    await Bun.sleep(0);
    expect(fake.requests()).toBe(1);

    fake.emit({ kind: "settings_committed", messageId: "settings", revision: 1, changedSections: ["preferences"] });
    await Bun.sleep(0);
    expect(fake.requests()).toBe(2);
    expect(envelopes).toHaveLength(2);

    binding.dispose();
    fake.emit({ kind: "host_unavailable", messageId: "host", reason: "host_stopped" });
    await Bun.sleep(0);
    expect(fake.requests()).toBe(2);
  });
});
