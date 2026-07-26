import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { toActivitySequence, toOpaqueId, type ActivityEventId } from "@kitten/engine";
import { createActivityIngestor } from "../attempts/activityIngestor.ts";
import { createAttentionFixture } from "../attention/testSupport.ts";
import type {
  EventJournal,
  ReviewEvidenceRecord,
} from "../persistence/eventJournal.ts";
import { closeSqliteDatabase } from "../persistence/sqliteDatabase.ts";
import type {
  ContractError,
  ReviewDispositionInput,
  ReviewEvidencePrecondition,
} from "../shared/rpc.ts";
import type { CardWorktreeBinding } from "../worktrees/contracts.ts";
import type { LifecycleDiagnostic } from "./lifecycleDiagnostics.ts";
import { createReviewDispositionService } from "./reviewDisposition.ts";

interface ReadyFixture {
  readonly database: ReturnType<typeof createAttentionFixture>["database"];
  readonly journal: EventJournal;
  readonly evidence: ReviewEvidenceRecord;
  readonly input: ReviewDispositionInput;
}

function createEvidence(
  journal: EventJournal,
  binding: CardWorktreeBinding,
): ReviewEvidenceRecord {
  const snapshot = journal.snapshot();
  const card = snapshot.cards[0]!;
  const attempt = snapshot.attempts[0]!;
  const patchBlob = new TextEncoder().encode(`review patch ${card.version}\n`);
  const patchDigest = createHash("sha256").update(patchBlob).digest("hex");
  const evidenceId = `evidence-${card.version}`;
  const evidence: ReviewEvidenceRecord = {
    evidenceId,
    boardId: card.boardId,
    cardId: card.cardId,
    attemptId: attempt.attemptId as ReviewEvidenceRecord["attemptId"],
    generation: attempt.generation,
    worktreeBindingId: binding.bindingId,
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40),
    policyVersion: 1,
    evidenceDigest: createHash("sha256").update(`evidence-${card.version}`).digest("hex"),
    fileCount: 1,
    totalPatchBytes: patchBlob.byteLength,
    createdAt: 145,
    files: [{
      evidenceId,
      fileIndex: 0,
      fileId: "file-review",
      status: "modified",
      oldPath: "src/review.ts",
      newPath: "src/review.ts",
      oldMode: "100644",
      newMode: "100644",
      isBinary: false,
      additions: 1,
      deletions: 0,
      patchByteLength: patchBlob.byteLength,
      patchDigest,
      contentDigest: null,
      patchBlob,
    }],
  };
  return evidence;
}

function precondition(evidence: ReviewEvidenceRecord): ReviewEvidencePrecondition {
  return {
    evidenceId: evidence.evidenceId,
    evidenceDigest: evidence.evidenceDigest,
    attemptId: evidence.attemptId,
    generation: evidence.generation,
    worktreeBindingId: evidence.worktreeBindingId,
  };
}

async function readyFixture(options: { readonly withEvidence?: boolean } = {}): Promise<ReadyFixture> {
  const { database, journal } = createAttentionFixture();
  const initial = journal.snapshot();
  const attempt = initial.attempts[0]!;
  const committed = await createActivityIngestor({ journal }).ingest({
    eventId: toOpaqueId<ActivityEventId>(`review-success-${crypto.randomUUID()}`)!,
    attemptId: attempt.attemptId,
    generation: attempt.generation,
    sequence: toActivitySequence(2)!,
    occurredAt: 130,
    activity: { kind: "attempt_state", state: "succeeded" },
  });
  if (committed.status !== "committed") throw new Error("failed to seed succeeded attempt");

  const binding = journal.snapshot().runContexts[0]!.worktree;
  journal.append({
    eventId: `review-binding-${crypto.randomUUID()}`,
    boardId: binding.boardId,
    cardId: binding.cardId,
    actor: "system",
    kind: "card_worktree_binding_recorded",
    occurredAt: 141,
    payload: binding,
  });
  const currentCard = journal.snapshot().cards[0]!;
  const evidence = options.withEvidence === false
    ? {
        evidenceId: "missing",
        boardId: currentCard.boardId,
        cardId: currentCard.cardId,
        attemptId: attempt.attemptId as ReviewEvidenceRecord["attemptId"],
        generation: attempt.generation,
        worktreeBindingId: binding.bindingId,
        baseCommit: "a".repeat(40),
        headCommit: "b".repeat(40),
        policyVersion: 1,
        evidenceDigest: "0".repeat(64),
        fileCount: 0,
        totalPatchBytes: 0,
        createdAt: 145,
        files: [],
      } satisfies ReviewEvidenceRecord
    : createEvidence(journal, binding);
  const readyCard = {
    ...currentCard,
    executionStatus: "ready_for_review" as const,
    version: currentCard.version + 1,
    updatedAt: 145,
  };
  if (options.withEvidence === false) {
    journal.append({
      eventId: `review-ready-${crypto.randomUUID()}`,
      boardId: currentCard.boardId,
      cardId: currentCard.cardId,
      actor: "system",
      kind: "card_upserted",
      occurredAt: 145,
      payload: readyCard,
    });
  } else {
    journal.immediate((transaction) => {
      transaction.persistReviewEvidence(evidence);
      transaction.append({
        eventId: `evidence:${evidence.evidenceId}`,
        boardId: currentCard.boardId,
        cardId: currentCard.cardId,
        actor: "system",
        kind: "review_evidence_committed",
        occurredAt: evidence.createdAt,
        payload: {
          evidence: {
            evidenceId: evidence.evidenceId,
            boardId: evidence.boardId,
            cardId: evidence.cardId,
            attemptId: evidence.attemptId,
            generation: evidence.generation,
            worktreeBindingId: evidence.worktreeBindingId,
            evidenceDigest: evidence.evidenceDigest,
            createdAt: evidence.createdAt,
          },
          changes: [{
            entity: "card",
            operation: "upsert",
            value: readyCard,
          }],
        },
      }, {
        preconditions: [{
          entity: "card",
          id: currentCard.cardId,
          expectedVersion: currentCard.version,
        }],
      });
    });
  }
  const card = journal.snapshot().cards[0]!;
  return {
    database,
    journal,
    evidence,
    input: {
      commandId: "review-1",
      boardId: card.boardId,
      cardId: card.cardId,
      expectedCardVersion: card.version,
      disposition: "approved",
      evidence: precondition(evidence),
    },
  };
}

function currentEvidenceService(evidence: ReviewEvidencePrecondition) {
  return {
    async revalidate() {
      return {
        status: "current" as const,
        evidenceId: evidence.evidenceId,
        evidenceDigest: evidence.evidenceDigest,
      };
    },
  };
}

describe("evidence-bound review disposition", () => {
  test("rejects legacy review-ready cards without evidence and appends no disposition", async () => {
    const fixture = await readyFixture({ withEvidence: false });
    try {
      const result = await createReviewDispositionService({
        journal: fixture.journal,
        evidence: currentEvidenceService(fixture.input.evidence),
      }).reviewCard(fixture.input);
      expect(result).toEqual({
        status: "rejected",
        error: { code: "evidence_missing", recoveryHint: "retry_evidence_capture" },
      });
      expect(fixture.journal.snapshot().reviewDispositions).toEqual([]);
    } finally {
      closeSqliteDatabase(fixture.database);
    }
  });

  test("revalidates the exact evidence, atomically completes the card, and deduplicates an exact command", async () => {
    const fixture = await readyFixture();
    try {
      let revalidations = 0;
      const diagnostics: LifecycleDiagnostic[] = [];
      const service = createReviewDispositionService({
        journal: fixture.journal,
        evidence: {
          async revalidate() {
            revalidations += 1;
            return {
              status: "current",
              evidenceId: fixture.evidence.evidenceId,
              evidenceDigest: fixture.evidence.evidenceDigest,
            };
          },
        },
        now: () => 150,
        diagnostics: { record: (diagnostic) => diagnostics.push(diagnostic) },
      });

      expect(await service.reviewCard(fixture.input)).toEqual({
        status: "ok",
        outcome: "approved",
        cardVersion: fixture.input.expectedCardVersion + 1,
      });
      expect(await service.reviewCard(fixture.input)).toEqual({
        status: "ok",
        outcome: "idempotent",
        cardVersion: fixture.input.expectedCardVersion + 1,
      });
      expect(revalidations).toBe(1);
      expect(fixture.journal.snapshot().cards[0]).toMatchObject({
        executionStatus: "completed",
        version: fixture.input.expectedCardVersion + 1,
      });
      expect(fixture.journal.snapshot().reviewDispositions).toEqual([{
        reviewId: fixture.input.commandId,
        boardId: fixture.input.boardId,
        cardId: fixture.input.cardId,
        ...fixture.input.evidence,
        disposition: "approved",
        reviewer: "operator",
        reviewedCardVersion: fixture.input.expectedCardVersion,
        occurredAt: 150,
      }]);
      expect(diagnostics).toEqual([{
        name: "review_disposition_recorded",
        boardId: fixture.input.boardId,
        cardId: fixture.input.cardId,
        outcome: "completed",
      }]);
    } finally {
      closeSqliteDatabase(fixture.database);
    }
  });

  test("rejects every stale evidence precondition without revalidation or disposition", async () => {
    const mutations: Array<{
      readonly name: string;
      readonly input: (input: ReviewDispositionInput) => ReviewDispositionInput;
      readonly code: ContractError["code"];
    }> = [
      {
        name: "card version",
        input: (input) => ({ ...input, expectedCardVersion: input.expectedCardVersion - 1 }),
        code: "stale_projection",
      },
      {
        name: "evidence id",
        input: (input) => ({ ...input, evidence: { ...input.evidence, evidenceId: "other-evidence" } }),
        code: "evidence_stale",
      },
      {
        name: "digest",
        input: (input) => ({ ...input, evidence: { ...input.evidence, evidenceDigest: "f".repeat(64) } }),
        code: "evidence_stale",
      },
      {
        name: "attempt",
        input: (input) => ({ ...input, evidence: { ...input.evidence, attemptId: "other-attempt" as typeof input.evidence.attemptId } }),
        code: "evidence_stale",
      },
      {
        name: "generation",
        input: (input) => ({ ...input, evidence: { ...input.evidence, generation: (Number(input.evidence.generation) + 1) as typeof input.evidence.generation } }),
        code: "evidence_stale",
      },
      {
        name: "binding",
        input: (input) => ({ ...input, evidence: { ...input.evidence, worktreeBindingId: "other-binding" } }),
        code: "evidence_stale",
      },
    ];

    for (const mutation of mutations) {
      const fixture = await readyFixture();
      try {
        let revalidations = 0;
        const result = await createReviewDispositionService({
          journal: fixture.journal,
          evidence: {
            async revalidate() {
              revalidations += 1;
              return {
                status: "current",
                evidenceId: fixture.evidence.evidenceId,
                evidenceDigest: fixture.evidence.evidenceDigest,
              };
            },
          },
        }).reviewCard(mutation.input(fixture.input));
        expect(result.status, mutation.name).toBe("rejected");
        if (result.status !== "rejected") throw new Error("expected stale rejection");
        expect(result.error.code, mutation.name).toBe(mutation.code);
        expect(revalidations, mutation.name).toBe(0);
        expect(fixture.journal.snapshot().reviewDispositions, mutation.name).toEqual([]);
      } finally {
        closeSqliteDatabase(fixture.database);
      }
    }
  });

  test("maps fresh digest failures and concurrent card mutation to typed recovery without a disposition", async () => {
    const staleFixture = await readyFixture();
    try {
      const stale = await createReviewDispositionService({
        journal: staleFixture.journal,
        evidence: {
          async revalidate() {
            return { status: "unavailable" as const, reason: "stale" as const };
          },
        },
      }).reviewCard(staleFixture.input);
      expect(stale).toEqual({
        status: "rejected",
        error: { code: "evidence_stale", recoveryHint: "reload_evidence" },
      });
      expect(staleFixture.journal.snapshot().reviewDispositions).toEqual([]);
    } finally {
      closeSqliteDatabase(staleFixture.database);
    }

    const racedFixture = await readyFixture();
    try {
      const result = await createReviewDispositionService({
        journal: racedFixture.journal,
        evidence: currentEvidenceService(racedFixture.input.evidence),
        afterRevalidation() {
          const card = racedFixture.journal.snapshot().cards[0]!;
          racedFixture.journal.append({
            eventId: "review-race-card",
            boardId: card.boardId,
            cardId: card.cardId,
            actor: "operator",
            kind: "card_upserted",
            occurredAt: 151,
            payload: {
              ...card,
              title: `${card.title} changed`,
              version: card.version + 1,
              updatedAt: 151,
            },
          });
        },
      }).reviewCard(racedFixture.input);
      expect(result).toEqual({
        status: "rejected",
        error: {
          code: "stale_projection",
          recoveryHint: "refresh_projection",
          expectedVersion: racedFixture.input.expectedCardVersion,
          actualVersion: racedFixture.input.expectedCardVersion + 1,
        },
      });
      expect(racedFixture.journal.snapshot().reviewDispositions).toEqual([]);
    } finally {
      closeSqliteDatabase(racedFixture.database);
    }
  });

  test("rejects reuse of an approval command id with different evidence", async () => {
    const fixture = await readyFixture();
    try {
      const service = createReviewDispositionService({
        journal: fixture.journal,
        evidence: currentEvidenceService(fixture.input.evidence),
      });
      expect((await service.reviewCard(fixture.input)).status).toBe("ok");
      expect(await service.reviewCard({
        ...fixture.input,
        evidence: { ...fixture.input.evidence, evidenceDigest: "f".repeat(64) },
      })).toEqual({
        status: "rejected",
        error: { code: "invalid_prompt", recoveryHint: "none" },
      });
      expect(fixture.journal.snapshot().reviewDispositions).toHaveLength(1);
    } finally {
      closeSqliteDatabase(fixture.database);
    }
  });
});
