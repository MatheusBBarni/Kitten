import { afterEach, describe, expect, test } from "bun:test";
import { closeSqliteDatabase } from "../persistence/sqliteDatabase.ts";
import type { CardNotificationService } from "../notifications/cardNotificationService.ts";
import { createAttentionCoordinator } from "./attentionCoordinator.ts";
import { AttemptAskUserBridgeError, createAttemptAskUserBridge } from "./attemptAskUserBridge.ts";
import {
  ATTENTION_ATTEMPT_ID,
  ATTENTION_FORM,
  ATTENTION_GENERATION,
  createAttentionFixture,
} from "./testSupport.ts";

const databases: ReturnType<typeof createAttentionFixture>["database"][] = [];
afterEach(() => {
  while (databases.length > 0) closeSqliteDatabase(databases.pop()!);
});

function fixture() {
  const value = createAttentionFixture();
  databases.push(value.database);
  let event = 0;
  const notifications: CardNotificationService = {
    async notify() { return { state: "delivered", attemptedAt: 220 }; },
  };
  const attention = createAttentionCoordinator({
    journal: value.journal,
    notifications,
    now: () => 200 + event,
    createBlockerId: () => `bridge-blocker-${event + 1}`,
    createEventId: (operation) => `bridge-attention-${operation}-${++event}`,
  });
  const bridge = createAttemptAskUserBridge({
    journal: value.journal,
    attention,
    createCapability: () => "c".repeat(43),
  });
  return { ...value, attention, bridge };
}

describe("attempt-generation authenticated ask_user bridge", () => {
  test("forwards one authenticated call, rejects duplicate call ID, and commits before returning outcome", async () => {
    const { journal, attention, bridge } = fixture();
    const route = bridge.register({ attemptId: ATTENTION_ATTEMPT_ID, generation: ATTENTION_GENERATION });
    const forwarded = bridge.forward({ capability: route.capability, callId: "call-1", form: ATTENTION_FORM });
    const blocker = await waitForBlocker(journal);
    await expect(bridge.forward({ capability: route.capability, callId: "call-1", form: ATTENTION_FORM }))
      .rejects.toMatchObject({ code: "invalid_request", reason: "duplicate_call_id" });
    attention.resolve({
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      blockerId: blocker.blockerId,
      expectedVersion: blocker.version,
      outcome: { kind: "submitted", answers: { choice: { selectedOptionIds: ["safe"] } } },
    });
    const outcome = await forwarded;
    expect(outcome).toEqual({ kind: "submitted", answers: { choice: { selectedOptionIds: ["safe"] } } });
    expect(journal.snapshot().attentionBlockers[0]).toMatchObject({ active: false, outcome });
  });

  test("fails closed for invalid capability, malformed form, stale generation, and terminal attempt", async () => {
    const { database, bridge } = fixture();
    const route = bridge.register({ attemptId: ATTENTION_ATTEMPT_ID, generation: ATTENTION_GENERATION });
    await expect(bridge.forward({ capability: "x".repeat(43), callId: "call-bad-cap", form: ATTENTION_FORM }))
      .rejects.toMatchObject({ code: "unavailable" });
    await expect(bridge.forward({
      capability: route.capability,
      callId: "call-bad-form",
      form: { ...ATTENTION_FORM, fields: [] },
    })).rejects.toMatchObject({ code: "invalid_request", reason: "form_invalid" });

    database.run("UPDATE attempts SET generation = 2 WHERE attempt_id = ?", [ATTENTION_ATTEMPT_ID]);
    await expect(bridge.forward({ capability: route.capability, callId: "call-stale", form: ATTENTION_FORM }))
      .rejects.toMatchObject({ code: "unavailable", reason: "attempt_stale_or_terminal" });

    const second = fixture();
    const terminalRoute = second.bridge.register({ attemptId: ATTENTION_ATTEMPT_ID, generation: ATTENTION_GENERATION });
    second.database.run("UPDATE attempts SET state = 'cancelled', terminal_at = 300 WHERE attempt_id = ?", [ATTENTION_ATTEMPT_ID]);
    await expect(second.bridge.forward({ capability: terminalRoute.capability, callId: "call-terminal", form: ATTENTION_FORM }))
      .rejects.toMatchObject({ code: "unavailable", reason: "attempt_stale_or_terminal" });
  });

  test("revocation cancels one pending blocker durably and rejects every later route use", async () => {
    const { journal, bridge } = fixture();
    const route = bridge.register({ attemptId: ATTENTION_ATTEMPT_ID, generation: ATTENTION_GENERATION });
    const forwarded = bridge.forward({ capability: route.capability, callId: "call-revoked", form: ATTENTION_FORM });
    await waitForBlocker(journal);
    bridge.revoke(route);
    expect(await forwarded).toEqual({ kind: "cancelled" });
    expect(journal.snapshot().attentionBlockers[0]).toMatchObject({ active: false, outcome: { kind: "cancelled" } });
    await expect(bridge.forward({ capability: route.capability, callId: "call-after-revoke", form: ATTENTION_FORM }))
      .rejects.toBeInstanceOf(AttemptAskUserBridgeError);
  });

  test("rejects a second simultaneous call while one active blocker owns the attempt", async () => {
    const { journal, attention, bridge } = fixture();
    const route = bridge.register({ attemptId: ATTENTION_ATTEMPT_ID, generation: ATTENTION_GENERATION });
    const first = bridge.forward({ capability: route.capability, callId: "call-first", form: ATTENTION_FORM });
    const blocker = await waitForBlocker(journal);
    await expect(bridge.forward({ capability: route.capability, callId: "call-second", form: ATTENTION_FORM }))
      .rejects.toMatchObject({ code: "busy", reason: "blocker_active" });
    attention.resolve({
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      blockerId: blocker.blockerId,
      expectedVersion: blocker.version,
      outcome: { kind: "skipped" },
    });
    expect(await first).toEqual({ kind: "skipped" });
  });
});

async function waitForBlocker(journal: ReturnType<typeof createAttentionFixture>["journal"]) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const blocker = journal.snapshot().attentionBlockers[0];
    if (blocker !== undefined && blocker.notification.state !== "pending") return blocker;
    await Promise.resolve();
  }
  throw new Error("Attention Blocker was not committed");
}
