import { describe, expect, test } from "bun:test";
import { toAttemptGeneration, toOpaqueId, type AttemptId } from "@kitten/engine";
import { createAttentionCoordinator } from "../attention/attentionCoordinator.ts";
import { ATTENTION_ATTEMPT_ID, ATTENTION_FORM, ATTENTION_GENERATION, createAttentionFixture } from "../attention/testSupport.ts";
import { createCardNotificationService } from "../notifications/cardNotificationService.ts";
import { closeSqliteDatabase } from "../persistence/sqliteDatabase.ts";
import { workflowIds } from "../workflow/workflowTypes.ts";
import type { LifecycleDiagnostic } from "./lifecycleDiagnostics.ts";
import { recoverInterruptedAttempts } from "./recovery.ts";

describe("startup attempt recovery", () => {
  test("interrupts a running attempt exactly once, preserves stage and evidence, and emits content-free diagnostics", () => {
    const { database, journal } = createAttentionFixture();
    try {
      const before = journal.snapshot();
      const diagnostics: LifecycleDiagnostic[] = [];
      const result = recoverInterruptedAttempts({
        journal,
        now: () => 200,
        createEventId: () => "recovery-running",
        diagnostics: { record: (diagnostic) => diagnostics.push(diagnostic) },
      });
      const after = journal.snapshot();
      expect(result.interruptedAttemptIds).toEqual([ATTENTION_ATTEMPT_ID]);
      expect(after.attempts[0]).toMatchObject({ state: "interrupted", terminalAt: 200, sessionId: "session-attention" });
      expect(after.attemptInspectors[0]).toMatchObject({ terminalOutcome: "interrupted" });
      expect(after.cards[0]).toMatchObject({ stageId: before.cards[0]!.stageId, executionStatus: "failed" });
      expect(after.runContexts).toEqual(before.runContexts);
      expect(after.cardWorktrees).toEqual(before.cardWorktrees);
      expect(after.reviewDispositions).toEqual([]);
      expect(diagnostics).toEqual([{
        name: "attempt_recovered",
        boardId: before.boards[0]!.boardId,
        cardId: before.cards[0]!.cardId,
        attemptId: ATTENTION_ATTEMPT_ID,
        generation: ATTENTION_GENERATION,
        outcome: "interrupted",
      }]);
      const serialized = JSON.stringify(diagnostics);
      for (const forbidden of ["secret prompt", "Execute fixture", "/secret/path", "secret-provider", "session-attention"]) {
        expect(serialized).not.toContain(forbidden);
      }

      const revision = after.revision;
      expect(recoverInterruptedAttempts({ journal, now: () => 300 })).toEqual({ interruptedAttemptIds: [], deltas: [] });
      expect(journal.snapshot().revision).toBe(revision);
      expect(journal.events().filter(({ kind }) => kind === "attempt_interrupted")).toHaveLength(1);
    } finally {
      closeSqliteDatabase(database);
    }
  });

  test("terminalizes an active blocker while retaining its form and leaves terminal attempts untouched", async () => {
    const { database, journal } = createAttentionFixture();
    try {
      const attention = createAttentionCoordinator({
        journal,
        notifications: createCardNotificationService({ deliver() {}, now: () => 110 }),
        now: () => 109,
        createBlockerId: () => "blocker-recovery",
        createEventId: (operation) => `attention-recovery-${operation}`,
      });
      const raised = await attention.raise({
        attemptId: ATTENTION_ATTEMPT_ID,
        generation: ATTENTION_GENERATION,
        callId: "call-recovery",
        form: ATTENTION_FORM,
      });
      recoverInterruptedAttempts({ journal, now: () => 200, createEventId: () => "recovery-blocked" });
      const snapshot = journal.snapshot();
      expect(snapshot.attentionBlockers[0]).toEqual({
        ...raised.blocker,
        active: false,
        outcome: { kind: "cancelled" },
        version: raised.blocker.version + 1,
        updatedAt: 200,
        terminalAt: 200,
      });
      expect(snapshot.attentionBlockers[0]!.form).toEqual(ATTENTION_FORM);
      const unchanged = journal.snapshot();
      expect(recoverInterruptedAttempts({ journal, now: () => 250 }).interruptedAttemptIds).toEqual([]);
      expect(journal.snapshot()).toEqual(unchanged);
    } finally {
      closeSqliteDatabase(database);
    }
  });

  test("rolls back every interruption when any event in the startup batch conflicts", () => {
    const { database, journal } = createAttentionFixture();
    try {
      const snapshot = journal.snapshot();
      const cardId = workflowIds.card("card-recovery-second");
      const attemptId = toOpaqueId<AttemptId>("attempt-recovery-second")!;
      const generation = toAttemptGeneration(1)!;
      const originalCard = snapshot.cards[0]!;
      const originalContext = snapshot.runContexts[0]!;
      const card = { ...originalCard, cardId, executionStatus: "idle" as const, version: 1 };
      journal.append({
        eventId: "recovery-second-card",
        boardId: card.boardId,
        cardId,
        actor: "operator",
        kind: "card_upserted",
        occurredAt: 90,
        payload: card,
      });
      const starting = {
        ...snapshot.attempts[0]!,
        attemptId,
        cardId,
        generation,
        state: "starting" as const,
        sessionId: null,
        createdAt: 100,
        startedAt: null,
      };
      const context = {
        ...originalContext,
        attemptId,
        generation,
        card: { ...originalContext.card, cardId },
        worktree: {
          ...originalContext.worktree,
          bindingId: "kw-recovery0002",
          cardId,
          worktreePath: "/secret/path/.kitten/worktrees/cards/kw-recovery0002",
          branch: "kitten/card/kw-recovery0002",
        },
      };
      journal.append({
        eventId: "recovery-second-created",
        boardId: card.boardId,
        cardId,
        attemptId,
        attemptSequence: 0,
        actor: "system",
        kind: "attempt_lifecycle_committed",
        occurredAt: 100,
        payload: {
          operation: "created",
          changes: [
            { entity: "card", operation: "upsert", value: { ...card, executionStatus: "running", version: 2, updatedAt: 100 } },
            { entity: "attempt", operation: "upsert", value: starting },
            { entity: "run_context", operation: "insert", value: context },
          ],
        },
      });
      journal.append({
        eventId: "recovery-second-started",
        boardId: card.boardId,
        cardId,
        attemptId,
        attemptSequence: 1,
        actor: "system",
        kind: "attempt_lifecycle_committed",
        occurredAt: 101,
        payload: {
          operation: "started",
          changes: [{
            entity: "attempt",
            operation: "upsert",
            value: { ...starting, state: "running", sessionId: "session-second", startedAt: 101 },
          }],
        },
      });
      const before = journal.snapshot();
      expect(() => recoverInterruptedAttempts({
        journal,
        now: () => 200,
        createEventId: () => "recovery-collision",
      })).toThrow();
      expect(journal.snapshot()).toEqual(before);
      expect(journal.events().filter(({ kind }) => kind === "attempt_interrupted")).toEqual([]);
      expect(journal.snapshot().attempts.map(({ state }) => state)).toEqual(["running", "running"]);
    } finally {
      closeSqliteDatabase(database);
    }
  });
});
