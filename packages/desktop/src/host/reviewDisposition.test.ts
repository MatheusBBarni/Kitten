import { describe, expect, test } from "bun:test";
import { createAttentionFixture } from "../attention/testSupport.ts";
import { DuplicateJournalEventError, type EventJournal, type JournalEvent } from "../persistence/eventJournal.ts";
import { closeSqliteDatabase } from "../persistence/sqliteDatabase.ts";
import { workflowIds } from "../workflow/workflowTypes.ts";
import { createDesktopCoordinator } from "./desktopCoordinator.ts";
import type { LifecycleDiagnostic } from "./lifecycleDiagnostics.ts";
import { recoverInterruptedAttempts } from "./recovery.ts";
import { createReviewDispositionService } from "./reviewDisposition.ts";

describe("review disposition", () => {
  test("rejects stale and wrong-state reviews, then persists the sole explicit completion evidence", () => {
    const { database, journal } = createAttentionFixture();
    try {
      recoverInterruptedAttempts({ journal, now: () => 120, createEventId: () => "review-seed-recovery" });
      const failedCard = journal.snapshot().cards[0]!;
      const service = createDesktopCoordinator({ journal, now: () => 150 });
      const input = {
        reviewId: "review-1",
        boardId: failedCard.boardId,
        cardId: failedCard.cardId,
        expectedCardVersion: failedCard.version,
        disposition: "approved" as const,
      };
      expect(service.reviewCard({ ...input, expectedCardVersion: failedCard.version - 1 })).toEqual({
        status: "conflict",
        expectedVersion: failedCard.version - 1,
        actualVersion: failedCard.version,
      });
      expect(service.reviewCard(input)).toEqual({ status: "rejected", reason: "wrong_state" });
      journal.append({
        eventId: "review-ready-card",
        boardId: failedCard.boardId,
        cardId: failedCard.cardId,
        actor: "system",
        kind: "card_upserted",
        occurredAt: 140,
        payload: {
          ...failedCard,
          executionStatus: "ready_for_review",
          version: failedCard.version + 1,
          updatedAt: 140,
        },
      });
      const ready = journal.snapshot().cards[0]!;
      const committed = service.reviewCard({ ...input, expectedCardVersion: ready.version });
      expect(committed).toMatchObject({ status: "committed", cardVersion: ready.version + 1 });
      expect(journal.snapshot().cards[0]).toMatchObject({ executionStatus: "completed", version: ready.version + 1 });
      expect(journal.snapshot().reviewDispositions).toEqual([{
        reviewId: "review-1",
        boardId: ready.boardId,
        cardId: ready.cardId,
        disposition: "approved",
        reviewer: "operator",
        reviewedCardVersion: ready.version,
        occurredAt: 150,
      }]);
      expect(service.reviewCard({ ...input, expectedCardVersion: ready.version })).toMatchObject({ status: "idempotent" });
      expect(service.reviewCard({ ...input, boardId: workflowIds.board("wrong-board") })).toEqual({
        status: "rejected",
        reason: "invalid_review_id",
      });
      expect(journal.snapshot().reviewDispositions).toHaveLength(1);
    } finally {
      closeSqliteDatabase(database);
    }
  });

  test("diagnostics expose only opaque card identity and outcome", () => {
    const { database, journal } = createAttentionFixture();
    try {
      recoverInterruptedAttempts({ journal, now: () => 120, createEventId: () => "diagnostic-seed-recovery" });
      const failed = journal.snapshot().cards[0]!;
      journal.append({
        eventId: "diagnostic-ready-card",
        boardId: failed.boardId,
        cardId: failed.cardId,
        actor: "system",
        kind: "card_upserted",
        occurredAt: 130,
        payload: { ...failed, executionStatus: "ready_for_review", version: failed.version + 1, updatedAt: 130 },
      });
      const ready = journal.snapshot().cards[0]!;
      const diagnostics: LifecycleDiagnostic[] = [];
      createReviewDispositionService({
        journal,
        now: () => 150,
        diagnostics: { record: (diagnostic) => diagnostics.push(diagnostic) },
      }).reviewCard({
        reviewId: "review-content-free",
        boardId: ready.boardId,
        cardId: ready.cardId,
        expectedCardVersion: ready.version,
        disposition: "approved",
      });
      expect(diagnostics).toEqual([{
        name: "review_disposition_recorded",
        boardId: ready.boardId,
        cardId: ready.cardId,
        outcome: "completed",
      }]);
      const serialized = JSON.stringify(diagnostics);
      for (const forbidden of ["secret prompt", "Execute fixture", "/secret/path", "secret-provider", "session-attention"]) {
        expect(serialized).not.toContain(forbidden);
      }
    } finally {
      closeSqliteDatabase(database);
    }
  });

  test("maps a concurrent duplicate append to the already committed disposition", () => {
    const { database, journal } = createAttentionFixture();
    try {
      recoverInterruptedAttempts({ journal, now: () => 120, createEventId: () => "duplicate-seed-recovery" });
      const failed = journal.snapshot().cards[0]!;
      const ready = { ...failed, executionStatus: "ready_for_review" as const, version: failed.version + 1, updatedAt: 130 };
      journal.append({
        eventId: "duplicate-ready-card",
        boardId: ready.boardId,
        cardId: ready.cardId,
        actor: "system",
        kind: "card_upserted",
        occurredAt: 130,
        payload: ready,
      });
      const completed = { ...ready, executionStatus: "completed" as const, version: ready.version + 1, updatedAt: 150 };
      const disposition = {
        reviewId: "review-concurrent",
        boardId: ready.boardId,
        cardId: ready.cardId,
        disposition: "approved" as const,
        reviewer: "operator" as const,
        reviewedCardVersion: ready.version,
        occurredAt: 150,
      };
      const committed = {
        eventId: "review:review-concurrent",
        boardId: ready.boardId,
        cardId: ready.cardId,
        actor: "operator",
        kind: "review_disposition_committed",
        occurredAt: 150,
        payload: {
          changes: [
            { entity: "review_disposition", operation: "insert", value: disposition },
            { entity: "card", operation: "upsert", value: completed },
          ],
        },
      } as JournalEvent;
      let lookups = 0;
      const racingJournal: EventJournal = {
        append() { throw new DuplicateJournalEventError(committed.eventId); },
        appendBatch: journal.appendBatch,
        snapshot: journal.snapshot,
        events: journal.events,
        eventById() { lookups += 1; return lookups === 1 ? null : committed; },
      };
      expect(createReviewDispositionService({ journal: racingJournal, now: () => 150 }).reviewCard({
        reviewId: disposition.reviewId,
        boardId: ready.boardId,
        cardId: ready.cardId,
        expectedCardVersion: ready.version,
        disposition: "approved",
      })).toEqual({
        status: "idempotent",
        disposition,
        cardVersion: completed.version,
        revision: journal.snapshot().revision,
      });
    } finally {
      closeSqliteDatabase(database);
    }
  });
});
