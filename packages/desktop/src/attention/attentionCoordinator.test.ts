import { afterEach, describe, expect, test } from "bun:test";
import type { QuestionId } from "@kitten/engine";
import { rebuildProjections } from "../persistence/projectionRebuilder.ts";
import { closeSqliteDatabase } from "../persistence/sqliteDatabase.ts";
import type { CardNotificationService } from "../notifications/cardNotificationService.ts";
import { createAttentionCoordinator, AttentionCoordinatorError } from "./attentionCoordinator.ts";
import type { AttentionOutcome } from "./contracts.ts";
import {
  ATTENTION_ATTEMPT_ID,
  ATTENTION_CARD_ID,
  ATTENTION_FORM,
  ATTENTION_GENERATION,
  ATTENTION_STAGE_ID,
  createAttentionFixture,
  staleGeneration,
} from "./testSupport.ts";

const databases: ReturnType<typeof createAttentionFixture>["database"][] = [];
afterEach(() => {
  while (databases.length > 0) closeSqliteDatabase(databases.pop()!);
});

const OUTCOMES: readonly AttentionOutcome[] = [
  { kind: "submitted", answers: { choice: { selectedOptionIds: ["safe"], customText: "" } } },
  { kind: "skipped" },
  { kind: "timed_out" },
  { kind: "cancelled" },
];

function fixture(delivery: CardNotificationService = deliveredNotifications()) {
  const value = createAttentionFixture();
  databases.push(value.database);
  let time = 200;
  let blocker = 0;
  let event = 0;
  const coordinator = createAttentionCoordinator({
    journal: value.journal,
    notifications: delivery,
    now: () => ++time,
    createBlockerId: () => `blocker-${++blocker}`,
    createEventId: (operation) => `attention-${operation}-${++event}`,
  });
  return { ...value, coordinator };
}

describe("durable Attention Blocker lifecycle", () => {
  test("creates valid default blocker and journal identities", async () => {
    const value = createAttentionFixture();
    databases.push(value.database);
    const coordinator = createAttentionCoordinator({
      journal: value.journal,
      notifications: deliveredNotifications(),
    });
    const handle = await coordinator.raise({
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      callId: "call-default-identities",
      form: ATTENTION_FORM,
    });
    expect(handle.blocker.blockerId).toStartWith("blocker:");
    expect(value.journal.events().at(-1)?.eventId).toStartWith("attention:notification_recorded:");
    coordinator.resolve({
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      blockerId: handle.blocker.blockerId,
      expectedVersion: handle.blocker.version,
      outcome: { kind: "skipped" },
    });
    expect(await handle.outcome).toEqual({ kind: "skipped" });
  });

  for (const outcome of OUTCOMES) {
    test(`persists ${outcome.kind} exactly once before same-attempt resume`, async () => {
      const { database, journal, coordinator } = fixture();
      const originalStage = journal.snapshot().cards[0]!.stageId;
      const handle = await coordinator.raise({
        attemptId: ATTENTION_ATTEMPT_ID,
        generation: ATTENTION_GENERATION,
        callId: `call-${outcome.kind}`,
        form: ATTENTION_FORM,
      });
      const blocked = journal.snapshot();
      expect(blocked.cards[0]).toMatchObject({
        cardId: ATTENTION_CARD_ID,
        stageId: originalStage,
        executionStatus: "needs_attention",
      });
      expect(blocked.attempts[0]?.state).toBe("needs_attention");
      expect(blocked.attentionBlockers[0]).toMatchObject({
        active: true,
        outcome: null,
        notification: { state: "delivered" },
      });

      const resolved = coordinator.resolve({
        attemptId: ATTENTION_ATTEMPT_ID,
        generation: ATTENTION_GENERATION,
        blockerId: handle.blocker.blockerId,
        expectedVersion: handle.blocker.version,
        outcome,
      });
      expect(await handle.outcome).toEqual(outcome);
      expect(resolved).toMatchObject({ active: false, outcome });
      const resumed = journal.snapshot();
      expect(resumed.cards[0]).toMatchObject({ stageId: originalStage, executionStatus: "running" });
      expect(resumed.attempts[0]?.state).toBe("running");
      expect(resumed.attentionBlockers[0]).toEqual(resolved);
      expect(journal.events().filter((entry) => (
        entry.kind === "attention_blocker_committed" && entry.payload.operation === "resolved"
      ))).toHaveLength(1);
      expect(() => coordinator.resolve({
        attemptId: ATTENTION_ATTEMPT_ID,
        generation: ATTENTION_GENERATION,
        blockerId: handle.blocker.blockerId,
        expectedVersion: resolved.version,
        outcome,
      })).toThrow(AttentionCoordinatorError);

      const live = journal.snapshot();
      expect(rebuildProjections(database)).toEqual(live);
    });
  }

  test("enforces one active blocker and leaves notification failure visible and unresolved", async () => {
    const failedNotifications: CardNotificationService = {
      async notify() { return { state: "failed", attemptedAt: 250, failureCode: "unavailable" }; },
    };
    const { journal, coordinator } = fixture(failedNotifications);
    const handle = await coordinator.raise({
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      callId: "call-primary",
      form: ATTENTION_FORM,
    });
    expect(handle.blocker).toMatchObject({
      active: true,
      outcome: null,
      notification: { state: "failed", attemptedAt: 250, failureCode: "unavailable" },
    });
    expect(journal.snapshot().cards[0]?.executionStatus).toBe("needs_attention");
    expect(coordinator.hasActive(ATTENTION_ATTEMPT_ID)).toBeTrue();
    await expect(coordinator.raise({
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      callId: "call-secondary",
      form: ATTENTION_FORM,
    })).rejects.toMatchObject({ code: "blocker_active" });
    expect(journal.snapshot().attentionBlockers).toHaveLength(1);
  });

  test("rejects stale generation, terminal attempts, unknown blockers, and stale outcome versions", async () => {
    const { database, coordinator } = fixture();
    await expect(coordinator.raise({
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: staleGeneration(),
      callId: "call-stale",
      form: ATTENTION_FORM,
    })).rejects.toMatchObject({ code: "stale_generation" });

    const handle = await coordinator.raise({
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      callId: "call-live",
      form: ATTENTION_FORM,
    });
    expect(() => coordinator.resolve({
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      blockerId: "missing" as QuestionId,
      expectedVersion: 1,
      outcome: { kind: "skipped" },
    })).toThrow("does not exist");
    expect(() => coordinator.resolve({
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      blockerId: handle.blocker.blockerId,
      expectedVersion: handle.blocker.version - 1,
      outcome: { kind: "skipped" },
    })).toThrow("version is stale");

    database.run("UPDATE attempts SET state = 'cancelled', terminal_at = 300 WHERE attempt_id = ?", [ATTENTION_ATTEMPT_ID]);
    expect(() => coordinator.resolve({
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      blockerId: handle.blocker.blockerId,
      expectedVersion: handle.blocker.version,
      outcome: { kind: "skipped" },
    })).toThrow("terminal");
  });

  test("rejects blocker identity mutation transactionally", async () => {
    const { journal, coordinator } = fixture();
    const handle = await coordinator.raise({
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      callId: "call-identity",
      form: ATTENTION_FORM,
    });
    const eventCount = journal.events().length;
    expect(() => journal.append({
      eventId: "attention-identity-conflict",
      boardId: handle.blocker.boardId,
      cardId: handle.blocker.cardId,
      actor: "system",
      kind: "attention_blocker_committed",
      occurredAt: 260,
      payload: {
        operation: "notification_recorded",
        changes: [{
          entity: "attention_blocker",
          operation: "upsert",
          value: {
            ...handle.blocker,
            callId: "call-rebound",
            version: handle.blocker.version + 1,
            updatedAt: 260,
          },
        }],
      },
    }, {
      preconditions: [{
        entity: "attention_blocker",
        id: handle.blocker.blockerId,
        expectedVersion: handle.blocker.version,
      }],
    })).toThrow("identity conflict");
    expect(journal.events()).toHaveLength(eventCount);
    expect(journal.snapshot().attentionBlockers[0]).toEqual(handle.blocker);
  });
});

function deliveredNotifications(): CardNotificationService {
  return {
    async notify() { return { state: "delivered", attemptedAt: 210 }; },
  };
}
