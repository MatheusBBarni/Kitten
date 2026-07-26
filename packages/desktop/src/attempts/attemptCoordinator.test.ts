import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  toActivitySequence,
  toOpaqueId,
  type ActivityEventId,
  type AttemptId,
  type ProfileId,
} from "@kitten/engine";
import type { SkillCatalog, SkillCatalogEntry } from "../catalog/contracts.ts";
import {
  createEventJournal,
  type EventJournal,
  type JournalEvent,
  type ReviewEvidenceRecord,
} from "../persistence/eventJournal.ts";
import { migrateDatabase } from "../persistence/migrations.ts";
import { rebuildProjections } from "../persistence/projectionRebuilder.ts";
import { closeSqliteDatabase, openSqliteDatabase } from "../persistence/sqliteDatabase.ts";
import type { CardWorktreeBinding } from "../worktrees/contracts.ts";
import type { ReviewEvidencePrecondition } from "../shared/rpc.ts";
import { workflowIds, type BoardId, type CardId, type CardProjection, type SkillId } from "../workflow/workflowTypes.ts";
import {
  completeSuccessfulAttempt,
  createAttemptCoordinator,
} from "./attemptCoordinator.ts";
import type { CertifiedDirectAcpProfile } from "./contracts.ts";
import { createDirectAcpAttemptStarter, type DirectAcpConnectionFactory } from "./directAcpAttempt.ts";
import { createGlobalAttemptScheduler } from "./scheduler.ts";
import type { AttemptAskUserBridge } from "../attention/attemptAskUserBridge.ts";
import { createActivityIngestor, type AttemptActivityIngestor } from "./activityIngestor.ts";
import { createWorkflowCommandHandler } from "../workflow/workflowCommands.ts";
import type {
  ReviewEvidenceService,
  ReviewEvidenceUnavailableReason,
} from "../host/reviewEvidence.ts";
import type {
  LifecycleDiagnostic,
  LifecycleDiagnostics,
  WorkflowMeasurementSink,
} from "../host/lifecycleDiagnostics.ts";

const databases: ReturnType<typeof openSqliteDatabase>[] = [];
afterEach(() => {
  while (databases.length > 0) {
    const database = databases.pop();
    if (database !== undefined) closeSqliteDatabase(database);
  }
});

const BOARD_ID = workflowIds.board("board-attempts");
const STAGE_ID = workflowIds.stage("stage-doing");
const CARD_ONE = workflowIds.card("card-one");
const CARD_TWO = workflowIds.card("card-two");
const SKILL_ID = workflowIds.skill(`skill:${"a".repeat(64)}`);
const OTHER_SKILL_ID = workflowIds.skill(`skill:${"c".repeat(64)}`);
const PROFILE_ID = "profile-certified-codex" as ProfileId;
const REPOSITORY = "/tmp/kitten-attempt-repository";

describe("attempt admission integration", () => {
  test("commits attempt and immutable Run Context before fresh newSession", async () => {
    const fixture = createFixture([CARD_ONE]);
    const observations: string[] = [];
    let loadSessionCalls = 0;
    let closeCalls = 0;
    const factory: DirectAcpConnectionFactory = {
      async connect() {
        observations.push("connect");
        assertCreated(fixture.journal, CARD_ONE);
        return {
          async newSession(input) {
            observations.push("newSession");
            assertCreated(fixture.journal, CARD_ONE);
            expect(input.cwd).toBe(fixture.binding(CARD_ONE).worktreePath);
            expect(input.skillContent).toContain("Execute the card");
            return { sessionId: "fresh-session-1" };
          },
          async prompt() { return { stopReason: "end_turn" }; },
          subscribeActivity() {
            return () => {};
          },
          async close() {
            closeCalls += 1;
          },
          async loadSession() {
            loadSessionCalls += 1;
          },
        } as ReturnType<DirectAcpConnectionFactory["connect"]> extends Promise<infer Connection>
          ? Connection
          : never;
      },
    };
    const scheduler = createGlobalAttemptScheduler();
    const coordinator = fixture.coordinator(factory, scheduler);

    const result = await coordinator.start(CARD_ONE);
    expect(result.status).toBe("started");
    if (result.status !== "started") throw new Error("expected started attempt");
    expect(observations).toEqual(["connect", "newSession"]);
    expect(result.sessionId).toBe("fresh-session-1");
    expect(Number(result.attempt.generation)).toBe(1);
    expect(loadSessionCalls).toBe(0);
    expect(lifecycleOperations(fixture.journal)).toEqual(["created", "started"]);
    expect(fixture.journal.snapshot().runContexts).toEqual([result.context]);

    const originalContext = structuredClone(result.context);
    fixture.catalog = catalog(OTHER_SKILL_ID, "Changed catalog bytes");
    mutateStageAndCard(fixture.journal, CARD_ONE, OTHER_SKILL_ID);
    expect(fixture.journal.snapshot().runContexts[0]).toEqual(originalContext);
    expect(() => fixture.database.run(
      "UPDATE run_contexts SET context_json = '{}' WHERE attempt_id = ?",
      [result.attempt.attemptId],
    )).toThrow("Run Contexts are immutable");

    expect(await coordinator.release(result.attempt.attemptId)).toBeTrue();
    expect(await coordinator.release(result.attempt.attemptId)).toBeFalse();
    expect(closeCalls).toBe(1);
    expect(scheduler.activeCount).toBe(0);
  });

  test("stops only the live generation through provider cancellation", async () => {
    const fixture = createFixture([CARD_ONE]);
    const cancellations: string[] = [];
    const coordinator = fixture.coordinator({
      async connect() {
        return {
          async newSession() { return { sessionId: "session-stop" }; },
          async prompt() { return { stopReason: "end_turn" }; },
          subscribeActivity() { return () => {}; },
          cancel({ sessionId }) { cancellations.push(sessionId); },
          close() {},
        };
      },
    });
    const started = await coordinator.start(CARD_ONE);
    if (started.status !== "started") throw new Error("expected started attempt");

    expect(await coordinator.stop({
      attemptId: started.attempt.attemptId,
      generation: (Number(started.attempt.generation) + 1) as typeof started.attempt.generation,
    })).toMatchObject({ status: "rejected", reason: { code: "stale_generation" } });
    expect(cancellations).toEqual([]);

    expect(await coordinator.stop({
      attemptId: started.attempt.attemptId,
      generation: started.attempt.generation,
    })).toEqual({ status: "ok" });
    expect(cancellations).toEqual(["session-stop"]);
    await coordinator.release(started.attempt.attemptId);
  });

  test("uses distinct sessions and increasing generations without loadSession after a failed startup commit", async () => {
    const fixture = createFixture([CARD_ONE]);
    let rejectFirstStartedCommit = true;
    const journal: EventJournal = {
      ...fixture.journal,
      append(input, options) {
        const event = input as { kind?: string; payload?: { operation?: string } };
        if (
          rejectFirstStartedCommit
          && event.kind === "attempt_lifecycle_committed"
          && event.payload?.operation === "started"
        ) {
          rejectFirstStartedCommit = false;
          throw new Error("simulated started projection failure");
        }
        return fixture.journal.append(input, options);
      },
    };
    const sessionIds: string[] = [];
    let loadSessionCalls = 0;
    const factory: DirectAcpConnectionFactory = {
      async connect() {
        return {
          async newSession() {
            const sessionId = `fresh-session-${sessionIds.length + 1}`;
            sessionIds.push(sessionId);
            return { sessionId };
          },
          async prompt() { return { stopReason: "end_turn" }; },
          subscribeActivity() {
            return () => {};
          },
          close() {},
          loadSession() {
            loadSessionCalls += 1;
          },
        } as ReturnType<DirectAcpConnectionFactory["connect"]> extends Promise<infer Connection>
          ? Connection
          : never;
      },
    };
    const scheduler = createGlobalAttemptScheduler();
    const coordinator = fixture.coordinator(factory, scheduler, journal);

    const first = await coordinator.start(CARD_ONE);
    expect(first.status).toBe("failed");
    if (first.status !== "failed" || first.attempt === null) throw new Error("expected persisted failure");
    expect(first.failure.code).toBe("startup_commit_failed");
    expect(Number(first.attempt.generation)).toBe(1);
    expect(scheduler.activeCount).toBe(0);

    const second = await coordinator.start(CARD_ONE);
    expect(second.status).toBe("started");
    if (second.status !== "started") throw new Error("expected retry to start");
    expect(Number(second.attempt.generation)).toBe(2);
    expect(sessionIds).toEqual(["fresh-session-1", "fresh-session-2"]);
    expect(loadSessionCalls).toBe(0);
    expect(fixture.journal.snapshot().runContexts.map((context) => Number(context.generation))).toEqual([1, 2]);
    expect(lifecycleOperations(fixture.journal)).toEqual([
      "created", "startup_failed", "created", "started",
    ]);
    await coordinator.release(second.attempt.attemptId);
  });

  test("persists a legible handshake failure on only the affected card and releases capacity", async () => {
    const fixture = createFixture([CARD_ONE, CARD_TWO]);
    const scheduler = createGlobalAttemptScheduler();
    const coordinator = fixture.coordinator({
      async connect() {
        throw new Error("Codex adapter authentication expired");
      },
    }, scheduler);

    const result = await coordinator.start(CARD_ONE);
    expect(result.status).toBe("failed");
    if (result.status !== "failed" || result.attempt === null) throw new Error("expected persisted failure");
    expect(result.failure).toMatchObject({
      code: "connection_failed",
      message: "Codex adapter authentication expired",
    });
    const snapshot = fixture.journal.snapshot();
    expect(snapshot.attempts).toHaveLength(1);
    expect(snapshot.attempts[0]).toEqual(result.attempt);
    expect(snapshot.cards.find(({ cardId }) => cardId === CARD_ONE)?.executionStatus).toBe("failed");
    expect(snapshot.cards.find(({ cardId }) => cardId === CARD_TWO)?.executionStatus).toBe("idle");
    expect(snapshot.runContexts).toHaveLength(1);
    expect(scheduler.activeCount).toBe(0);
  });

  test("journals the initial message and terminal outcome while prompt work continues off the RPC path", async () => {
    const fixture = createFixture([CARD_ONE]);
    const prompts: string[] = [];
    const coordinator = fixture.coordinator({
      async connect() {
        return {
          async newSession() { return { sessionId: "session-initial-prompt" }; },
          async prompt({ prompt }) { prompts.push(prompt); return { stopReason: "end_turn" }; },
          subscribeActivity() { return () => {}; },
          close() {},
        };
      },
    }, createGlobalAttemptScheduler(), fixture.journal, {
      activityIngestor: createActivityIngestor({ journal: fixture.journal }),
    });

    const started = await coordinator.start(CARD_ONE, "Review the latest UI changes");
    expect(started.status).toBe("started");
    for (let count = 0; count < 20 && fixture.journal.snapshot().attemptInspectors[0]?.terminalOutcome !== "succeeded"; count += 1) {
      await Promise.resolve();
    }
    expect(prompts).toEqual(["Review the latest UI changes"]);
    expect(fixture.journal.snapshot().attemptInspectors[0]?.entries).toMatchObject([
      { kind: "user", text: "Review the latest UI changes" },
      { kind: "terminal", outcome: "succeeded" },
    ]);
  });

  test("accepts a direction immediately and dispatches it after the active turn without confirmation", async () => {
    const fixture = createFixture([CARD_ONE]);
    const prompts: string[] = [];
    let releaseInitial: (() => void) | undefined;
    const initialSettled = new Promise<void>((resolve) => { releaseInitial = resolve; });
    const coordinator = fixture.coordinator({
      async connect() {
        return {
          async newSession() { return { sessionId: "session-steer" }; },
          async prompt({ prompt }) {
            prompts.push(prompt);
            if (prompts.length === 1) await initialSettled;
            return { stopReason: "end_turn" };
          },
          subscribeActivity() { return () => {}; },
          close() {},
        };
      },
    }, createGlobalAttemptScheduler(), fixture.journal, {
      activityIngestor: createActivityIngestor({ journal: fixture.journal }),
    });

    const started = await coordinator.start(CARD_ONE, "Initial direction");
    if (started.status !== "started") throw new Error("expected started attempt");
    for (let count = 0; count < 20 && prompts.length === 0; count += 1) await Promise.resolve();
    expect(prompts).toEqual(["Initial direction"]);

    expect(await coordinator.submitCardPrompt({
      commandId: "direction-1",
      boardId: BOARD_ID,
      cardId: CARD_ONE,
      expectedCardVersion: 2,
      source: "composer",
      content: "Check the changed panel too",
      activeAttempt: {
        attemptId: started.attempt.attemptId,
        generation: started.attempt.generation,
      },
    })).toMatchObject({ status: "ok", outcome: "queued" });
    expect(fixture.journal.snapshot().attemptInspectors[0]?.entries).toMatchObject([
      { kind: "user", text: "Initial direction" },
      { kind: "user", text: "Check the changed panel too" },
    ]);

    releaseInitial?.();
    for (let count = 0; count < 40 && fixture.journal.snapshot().attemptInspectors[0]?.terminalOutcome !== "succeeded"; count += 1) {
      await Promise.resolve();
    }
    expect(prompts).toEqual(["Initial direction", "Check the changed panel too"]);
    expect(fixture.journal.snapshot().attemptInspectors[0]?.terminalOutcome).toBe("succeeded");
    expect(fixture.journal.snapshot().followUpQueues[0]?.drafts.map(({ state }) => state)).toEqual(["dispatched"]);
  });
});

describe("final-stage review readiness admission", () => {
  test("passes the exact succeeded attempt binding to canonical capture and keeps every unavailable outcome non-reviewable", async () => {
    const fixture = createFixture([CARD_ONE]);
    const coordinator = fixture.coordinator({
      async connect() {
        return {
          async newSession() { return { sessionId: "session-review-gate" }; },
          async prompt() { return { stopReason: "end_turn" }; },
          subscribeActivity() { return () => {}; },
          close() {},
        };
      },
    });
    const started = await coordinator.start(CARD_ONE);
    if (started.status !== "started") throw new Error("expected started attempt");
    const terminal = await createActivityIngestor({ journal: fixture.journal }).ingest({
      eventId: toOpaqueId<ActivityEventId>("attempt-review-gate-success")!,
      attemptId: started.attempt.attemptId,
      generation: started.attempt.generation,
      sequence: toActivitySequence(2)!,
      occurredAt: 200,
      activity: { kind: "attempt_state", state: "succeeded" },
    });
    expect(terminal.status).toBe("committed");

    const reasons = [
      "missing",
      "stale",
      "oversized",
      "unsafe",
      "unsupported",
      "incomplete",
      "binding_mismatch",
      "stale_board",
      "stale_card",
      "stale_attempt",
    ] as const;
    const expectedCodes = {
      missing: "evidence_missing",
      stale: "evidence_stale",
      oversized: "evidence_oversized",
      unsafe: "evidence_unsafe",
      unsupported: "evidence_unsafe",
      incomplete: "evidence_unsafe",
      binding_mismatch: "worktree_binding_mismatch",
      stale_board: "evidence_stale",
      stale_card: "evidence_stale",
      stale_attempt: "evidence_stale",
    } as const;
    const measurement: unknown[] = [];

    for (const reason of reasons) {
      let capturedInput: unknown;
      const result = await completeSuccessfulAttempt({
        journal: fixture.journal,
        workflowCommands: createWorkflowCommandHandler(fixture.journal),
        reviewEvidence: {
          async capture(input) {
            capturedInput = input;
            return { status: "unavailable", reason };
          },
        },
        attemptId: started.attempt.attemptId,
        generation: started.attempt.generation,
        measurement: {
          record(event) {
            measurement.push(event);
          },
        },
      });
      expect(result).toMatchObject({
        status: "non_reviewable",
        reason,
        error: { code: expectedCodes[reason] },
      });
      expect(capturedInput).toEqual({
        boardId: BOARD_ID,
        expectedWorkflowVersion: 1,
        cardId: CARD_ONE,
        attemptId: started.attempt.attemptId,
        generation: started.attempt.generation,
        expectedCardVersion: 2,
        worktreeBindingId: started.context.worktree.bindingId,
      });
      expect(fixture.journal.snapshot().cards[0]).toMatchObject({
        executionStatus: "running",
        version: 2,
      });
      expect(fixture.journal.snapshot().reviewEvidenceByCard).toEqual({});
      expect(measurement.at(-1)).toEqual({
        schemaVersion: 1,
        name: "evidence_capture",
        outcome: "unavailable",
        fileCountBucket: "0",
        byteCountBucket: "0",
        reason: expectedCodes[reason],
      });
    }
  });
});

describe("unified prompt submission", () => {
  test("admits idle work with the exact message and durably deduplicates command retries", async () => {
    const fixture = createFixture([CARD_ONE]);
    const prompts: string[] = [];
    const coordinator = fixture.coordinator({
      async connect() {
        return {
          async newSession() { return { sessionId: "session-admitted" }; },
          async prompt({ prompt }) { prompts.push(prompt); return { stopReason: "end_turn" }; },
          subscribeActivity() { return () => {}; },
          close() {},
        };
      },
    }, createGlobalAttemptScheduler(), fixture.journal, {
      activityIngestor: createActivityIngestor({ journal: fixture.journal }),
    });
    const input = {
      commandId: "submit-initial",
      boardId: BOARD_ID,
      cardId: CARD_ONE,
      expectedCardVersion: 1,
      source: "initial" as const,
      content: "  Use the exact submitted prompt  ",
    };

    const first = await coordinator.submitCardPrompt(input);
    const duplicate = await coordinator.submitCardPrompt(input);
    const conflictingRetry = await coordinator.submitCardPrompt({
      ...input,
      content: "A different prompt under the same command identity",
    });
    expect(first).toMatchObject({ status: "ok", outcome: "admitted", cardVersion: 2 });
    expect(duplicate).toEqual(first);
    expect(conflictingRetry).toMatchObject({
      status: "rejected",
      error: { code: "invalid_prompt" },
    });
    for (let count = 0; count < 20 && prompts.length === 0; count += 1) await Promise.resolve();
    expect(prompts).toEqual(["  Use the exact submitted prompt  "]);
    expect(fixture.journal.events().filter(
      (event) => event.kind === "prompt_submission_committed",
    )).toHaveLength(1);
    expect(rebuildProjections(fixture.database)).toEqual(fixture.journal.snapshot());
  });

  test("admits evidence-bound Request changes atomically on the same card and stage before ACP startup", async () => {
    const fixture = createFixture([CARD_ONE]);
    const ready = await prepareReadyReview(fixture);
    const observations: string[] = [];
    const prompts: string[] = [];
    const diagnostics: LifecycleDiagnostic[] = [];
    const coordinator = fixture.coordinator({
      async connect() {
        observations.push("connect");
        const committed = fixture.journal.snapshot();
        expect(committed.cards).toHaveLength(1);
        expect(committed.cards[0]).toMatchObject({
          boardId: BOARD_ID,
          cardId: CARD_ONE,
          stageId: STAGE_ID,
          executionStatus: "running",
          version: ready.expectedCardVersion + 1,
        });
        expect(committed.attempts).toHaveLength(2);
        expect(committed.attempts[1]).toMatchObject({
          boardId: BOARD_ID,
          cardId: CARD_ONE,
          generation: 2,
          state: "starting",
        });
        expect(committed.runContexts).toHaveLength(2);
        expect(committed.runContexts[1]).toMatchObject({
          generation: 2,
          card: { cardId: CARD_ONE, version: ready.expectedCardVersion },
          stage: { stageId: STAGE_ID },
          workflow: { boardId: BOARD_ID },
          worktree: { bindingId: ready.evidence.worktreeBindingId },
        });
        expect(committed.reviewDispositions).toEqual([expect.objectContaining({
          reviewId: "request-changes-1",
          disposition: "changes_requested",
          reviewedCardVersion: ready.expectedCardVersion,
          evidenceId: ready.evidence.evidenceId,
          evidenceDigest: ready.evidence.evidenceDigest,
          attemptId: ready.evidence.attemptId,
          generation: ready.evidence.generation,
          worktreeBindingId: ready.evidence.worktreeBindingId,
        })]);
        return {
          async newSession() {
            observations.push("newSession");
            expect(fixture.journal.snapshot().reviewDispositions).toHaveLength(1);
            return { sessionId: "request-changes-session" };
          },
          async prompt({ prompt }) {
            prompts.push(prompt);
            return { stopReason: "end_turn" };
          },
          subscribeActivity() { return () => {}; },
          close() {},
        };
      },
    }, createGlobalAttemptScheduler(), fixture.journal, {
      reviewEvidence: currentEvidenceService(ready.evidence),
      diagnostics: { record: (diagnostic) => diagnostics.push(diagnostic) },
      activityIngestor: createActivityIngestor({ journal: fixture.journal }),
    });

    const beforeDraft = structuredClone(fixture.journal.snapshot());
    const localDraft = "Please address the review findings";
    expect(localDraft).toContain("review");
    expect(fixture.journal.snapshot()).toEqual(beforeDraft);

    const result = await coordinator.submitCardPrompt({
      commandId: "request-changes-1",
      boardId: BOARD_ID,
      cardId: CARD_ONE,
      expectedCardVersion: ready.expectedCardVersion,
      source: "request_changes",
      content: localDraft,
      evidence: ready.evidence,
    });
    expect(result).toMatchObject({
      status: "ok",
      outcome: "admitted",
      cardVersion: ready.expectedCardVersion + 1,
      generation: 2,
    });
    expect(observations).toEqual(["connect", "newSession"]);
    for (let count = 0; count < 20 && prompts.length === 0; count += 1) {
      await Promise.resolve();
    }
    expect(prompts).toEqual([localDraft]);
    expect(diagnostics).toEqual([{
      name: "review_disposition_recorded",
      boardId: BOARD_ID,
      cardId: CARD_ONE,
      outcome: "changes_requested",
    }]);
    expect(fixture.journal.events().filter(
      (event) => event.kind === "prompt_submission_committed",
    )).toHaveLength(1);
    expect(rebuildProjections(fixture.database)).toEqual(fixture.journal.snapshot());
  });

  test("deduplicates concurrent exact Request changes and rejects altered command identity reuse", async () => {
    const fixture = createFixture([CARD_ONE]);
    const ready = await prepareReadyReview(fixture);
    let releaseRevalidation: (() => void) | undefined;
    const revalidationBoundary = new Promise<void>((resolve) => {
      releaseRevalidation = resolve;
    });
    let revalidations = 0;
    let sessions = 0;
    let prompts = 0;
    const coordinator = fixture.coordinator({
      async connect() {
        return {
          async newSession() {
            sessions += 1;
            return { sessionId: "deduplicated-request-session" };
          },
          async prompt() {
            prompts += 1;
            return { stopReason: "end_turn" };
          },
          subscribeActivity() { return () => {}; },
          close() {},
        };
      },
    }, createGlobalAttemptScheduler(), fixture.journal, {
      reviewEvidence: {
        async revalidate() {
          revalidations += 1;
          await revalidationBoundary;
          return {
            status: "current",
            evidenceId: ready.evidence.evidenceId,
            evidenceDigest: ready.evidence.evidenceDigest,
          };
        },
      },
    });
    const input = {
      commandId: "request-concurrent",
      boardId: BOARD_ID,
      cardId: CARD_ONE,
      expectedCardVersion: ready.expectedCardVersion,
      source: "request_changes" as const,
      content: "Apply the exact requested correction",
      evidence: ready.evidence,
    };

    const first = coordinator.submitCardPrompt(input);
    const duplicate = coordinator.submitCardPrompt(input);
    const conflicting = coordinator.submitCardPrompt({
      ...input,
      content: "Different content under the same command",
    });
    await Promise.resolve();
    expect(revalidations).toBe(1);
    releaseRevalidation?.();
    const [firstResult, duplicateResult, conflictingResult] = await Promise.all([
      first,
      duplicate,
      conflicting,
    ]);
    expect(firstResult).toMatchObject({ status: "ok", outcome: "admitted" });
    expect(duplicateResult).toEqual(firstResult);
    expect(conflictingResult).toMatchObject({
      status: "rejected",
      error: { code: "invalid_prompt" },
    });
    expect(await coordinator.submitCardPrompt({
      ...input,
      evidence: {
        ...input.evidence,
        evidenceDigest: "f".repeat(64),
      },
    })).toMatchObject({
      status: "rejected",
      error: { code: "invalid_prompt" },
    });
    expect(fixture.journal.snapshot().reviewDispositions).toHaveLength(1);
    expect(fixture.journal.snapshot().attempts).toHaveLength(2);
    expect(fixture.journal.snapshot().runContexts).toHaveLength(2);
    expect(sessions).toBe(1);
    for (let count = 0; count < 20 && prompts === 0; count += 1) {
      await Promise.resolve();
    }
    expect(prompts).toBe(1);
  });

  test("rejects every unavailable Request changes evidence state without durable or ACP mutation", async () => {
    const fixture = createFixture([CARD_ONE]);
    const ready = await prepareReadyReview(fixture);
    const before = structuredClone(fixture.journal.snapshot());
    let reason: ReviewEvidenceUnavailableReason = "missing";
    let connects = 0;
    const coordinator = fixture.coordinator({
      async connect() {
        connects += 1;
        throw new Error("ACP must not start for unavailable evidence");
      },
    }, createGlobalAttemptScheduler(), fixture.journal, {
      reviewEvidence: {
        async revalidate() {
          return { status: "unavailable", reason };
        },
      },
    });
    const reasons = [
      "missing",
      "stale",
      "oversized",
      "unsafe",
      "unsupported",
      "incomplete",
      "binding_mismatch",
      "stale_board",
      "stale_card",
      "stale_attempt",
    ] as const;
    for (const [index, unavailableReason] of reasons.entries()) {
      reason = unavailableReason;
      expect(await coordinator.submitCardPrompt({
        commandId: `request-unavailable-${index}`,
        boardId: BOARD_ID,
        cardId: CARD_ONE,
        expectedCardVersion: ready.expectedCardVersion,
        source: "request_changes",
        content: "Explicit reviewer correction",
        evidence: ready.evidence,
      })).toMatchObject({ status: "rejected" });
      expect(fixture.journal.snapshot()).toEqual(before);
    }
    expect(connects).toBe(0);
  });

  test("fences Request changes source, reviewed identities, lifecycle state, and scheduler capacity", async () => {
    const fixture = createFixture([CARD_ONE]);
    const ready = await prepareReadyReview(fixture);
    let revalidations = 0;
    const scheduler = createGlobalAttemptScheduler();
    const coordinator = fixture.coordinator({
      async connect() {
        throw new Error("fenced request changes must not start ACP");
      },
    }, scheduler, fixture.journal, {
      reviewEvidence: {
        async revalidate() {
          revalidations += 1;
          return {
            status: "current",
            evidenceId: ready.evidence.evidenceId,
            evidenceDigest: ready.evidence.evidenceDigest,
          };
        },
      },
    });
    const base = {
      boardId: BOARD_ID,
      cardId: CARD_ONE,
      expectedCardVersion: ready.expectedCardVersion,
      source: "request_changes" as const,
      content: "Explicit evidence-bound correction",
      evidence: ready.evidence,
    };
    const before = structuredClone(fixture.journal.snapshot());
    expect(await coordinator.submitCardPrompt({
      ...base,
      commandId: "request-wrong-source",
      source: "composer",
    })).toMatchObject({ status: "rejected", error: { code: "invalid_prompt" } });
    expect(await coordinator.submitCardPrompt({
      ...base,
      commandId: "request-stale-card",
      expectedCardVersion: ready.expectedCardVersion - 1,
    })).toMatchObject({ status: "rejected", error: { code: "stale_projection" } });
    for (const [index, evidence] of [
      { ...ready.evidence, evidenceId: "wrong-evidence" },
      { ...ready.evidence, evidenceDigest: "f".repeat(64) },
      { ...ready.evidence, attemptId: "wrong-attempt" as AttemptId },
      {
        ...ready.evidence,
        generation: (Number(ready.evidence.generation) + 1) as typeof ready.evidence.generation,
      },
      { ...ready.evidence, worktreeBindingId: "wrong-binding" },
    ].entries()) {
      expect(await coordinator.submitCardPrompt({
        ...base,
        commandId: `request-stale-evidence-${index}`,
        evidence,
      })).toMatchObject({ status: "rejected" });
    }
    const reservation = scheduler.reserve(CARD_TWO);
    expect(reservation.status).toBe("reserved");
    expect(await coordinator.submitCardPrompt({
      ...base,
      commandId: "request-capacity",
    })).toMatchObject({ status: "rejected", error: { code: "attempt_active" } });
    if (reservation.status === "reserved") scheduler.release(reservation.reservation);
    expect(revalidations).toBe(0);
    expect(fixture.journal.snapshot()).toEqual(before);
  });

  test("rolls back disposition, card, replacement attempt, and Run Context when admission fails", async () => {
    const fixture = createFixture([CARD_ONE]);
    const ready = await prepareReadyReview(fixture);
    fixture.database.run(`
      CREATE TRIGGER fail_request_changes_run_context
      BEFORE INSERT ON run_contexts
      WHEN NEW.generation = 2
      BEGIN
        SELECT RAISE(ABORT, 'simulated request changes transaction failure');
      END
    `);
    const before = structuredClone(fixture.journal.snapshot());
    let connects = 0;
    const coordinator = fixture.coordinator({
      async connect() {
        connects += 1;
        throw new Error("ACP must not start after transaction rollback");
      },
    }, createGlobalAttemptScheduler(), fixture.journal, {
      reviewEvidence: currentEvidenceService(ready.evidence),
    });

    expect(await coordinator.submitCardPrompt({
      commandId: "request-rollback",
      boardId: BOARD_ID,
      cardId: CARD_ONE,
      expectedCardVersion: ready.expectedCardVersion,
      source: "request_changes",
      content: "This admission must roll back",
      evidence: ready.evidence,
    })).toMatchObject({ status: "rejected" });
    expect(fixture.journal.snapshot()).toEqual(before);
    expect(fixture.journal.eventById(
      `prompt-submission:${createHash("sha256").update("request-rollback").digest("hex")}`,
    )).toBeNull();
    expect(connects).toBe(0);
  });

  test("persists two active-turn submissions before acknowledgment and dispatches FIFO at successive boundaries", async () => {
    const fixture = createFixture([CARD_ONE]);
    const prompts: string[] = [];
    let releaseInitial: (() => void) | undefined;
    const initialBoundary = new Promise<void>((resolve) => { releaseInitial = resolve; });
    const coordinator = fixture.coordinator({
      async connect() {
        return {
          async newSession() { return { sessionId: "session-fifo" }; },
          async prompt({ prompt }) {
            prompts.push(prompt);
            if (prompts.length === 1) await initialBoundary;
            return { stopReason: "end_turn" };
          },
          subscribeActivity() { return () => {}; },
          close() {},
        };
      },
    });
    const started = await coordinator.start(CARD_ONE, "initial");
    if (started.status !== "started") throw new Error("expected started attempt");
    for (let count = 0; count < 20 && prompts.length === 0; count += 1) await Promise.resolve();
    const base = {
      boardId: BOARD_ID,
      cardId: CARD_ONE,
      expectedCardVersion: 2,
      source: "composer" as const,
      activeAttempt: {
        attemptId: started.attempt.attemptId,
        generation: started.attempt.generation,
      },
    };
    const first = await coordinator.submitCardPrompt({
      ...base,
      commandId: "submit-first",
      content: "first",
    });
    const second = await coordinator.submitCardPrompt({
      ...base,
      commandId: "submit-second",
      content: "second",
    });
    expect(first).toMatchObject({ status: "ok", outcome: "queued" });
    expect(second).toMatchObject({ status: "ok", outcome: "queued" });
    expect(prompts).toEqual(["initial"]);
    expect(fixture.journal.snapshot().followUpQueues[0]?.drafts.map(
      ({ text, state }) => ({ text, state }),
    )).toEqual([
      { text: "first", state: "queued" },
      { text: "second", state: "queued" },
    ]);

    releaseInitial?.();
    for (
      let count = 0;
      count < 80
      && fixture.journal.snapshot().followUpQueues[0]?.drafts.some(
        ({ state }) => state !== "dispatched",
      ) !== false;
      count += 1
    ) await Promise.resolve();
    expect(prompts).toEqual(["initial", "first", "second"]);
    expect(fixture.journal.snapshot().followUpQueues[0]?.drafts.map(
      ({ state }) => state,
    )).toEqual(["dispatched", "dispatched"]);
  });

  test("rejects invalid, blocked, stale, unavailable, and identity-conflicting submissions without mutation", async () => {
    const fixture = createFixture([CARD_ONE]);
    let blockerActive = false;
    let promptCalls = 0;
    const coordinator = fixture.coordinator({
      async connect() {
        return {
          async newSession() { return { sessionId: "session-fences" }; },
          async prompt() { promptCalls += 1; return { stopReason: "end_turn" }; },
          subscribeActivity() { return () => {}; },
          close() {},
        };
      },
    }, createGlobalAttemptScheduler(), fixture.journal, {
      hasActiveAttention: () => blockerActive,
    });
    const started = await coordinator.start(CARD_ONE);
    if (started.status !== "started") throw new Error("expected started attempt");
    const valid = {
      commandId: "submit-fenced",
      boardId: BOARD_ID,
      cardId: CARD_ONE,
      expectedCardVersion: 2,
      source: "composer" as const,
      content: "direction",
      activeAttempt: {
        attemptId: started.attempt.attemptId,
        generation: started.attempt.generation,
      },
    };
    const before = structuredClone(fixture.journal.snapshot());
    blockerActive = true;
    expect(await coordinator.submitCardPrompt(valid)).toMatchObject({
      status: "rejected",
      error: { code: "blocker_active" },
    });
    blockerActive = false;
    expect(await coordinator.submitCardPrompt({ ...valid, content: " " })).toMatchObject({
      status: "rejected",
      error: { code: "invalid_prompt" },
    });
    expect(await coordinator.submitCardPrompt({ ...valid, expectedCardVersion: 1 })).toMatchObject({
      status: "rejected",
      error: { code: "stale_projection" },
    });
    expect(await coordinator.submitCardPrompt({
      ...valid,
      activeAttempt: {
        ...valid.activeAttempt,
        generation: (Number(valid.activeAttempt.generation) + 1) as typeof valid.activeAttempt.generation,
      },
    })).toMatchObject({ status: "rejected", error: { code: "stale_projection" } });
    expect(await coordinator.submitCardPrompt({
      ...valid,
      source: "request_changes",
      evidence: {
        evidenceId: "evidence",
        evidenceDigest: "digest",
        attemptId: valid.activeAttempt.attemptId,
        generation: valid.activeAttempt.generation,
        worktreeBindingId: "binding",
      },
    })).toMatchObject({ status: "rejected", error: { code: "evidence_missing" } });
    expect(fixture.journal.snapshot()).toEqual(before);
    expect(promptCalls).toBe(0);
  });

  test("rejects completed lifecycle state without creating a queue, attempt, or ACP session", async () => {
    const fixture = createFixture([CARD_ONE]);
    const completed = {
      ...fixture.journal.snapshot().cards[0]!,
      executionStatus: "completed" as const,
      version: 2,
      updatedAt: 20,
    };
    fixture.journal.append({
      eventId: "complete-card-for-submission",
      boardId: BOARD_ID,
      cardId: CARD_ONE,
      actor: "operator",
      kind: "card_upserted",
      occurredAt: 20,
      payload: completed,
    });
    let connects = 0;
    const coordinator = fixture.coordinator({
      async connect() {
        connects += 1;
        throw new Error("must not connect");
      },
    });
    const before = structuredClone(fixture.journal.snapshot());
    expect(await coordinator.submitCardPrompt({
      commandId: "submit-completed",
      boardId: BOARD_ID,
      cardId: CARD_ONE,
      expectedCardVersion: 2,
      source: "initial",
      content: "Do not admit completed work",
    })).toMatchObject({ status: "rejected", error: { code: "invalid_prompt" } });
    expect(fixture.journal.snapshot()).toEqual(before);
    expect(connects).toBe(0);
  });

  test("marks ambiguous post-dispatching delivery interrupted and emits closed measurement", async () => {
    const fixture = createFixture([CARD_ONE]);
    const measurement: unknown[] = [];
    let releaseInitial: (() => void) | undefined;
    const initialBoundary = new Promise<void>((resolve) => { releaseInitial = resolve; });
    let promptCalls = 0;
    const coordinator = fixture.coordinator({
      async connect() {
        return {
          async newSession() { return { sessionId: "session-interrupted" }; },
          async prompt() {
            promptCalls += 1;
            if (promptCalls === 1) {
              await initialBoundary;
              return { stopReason: "end_turn" };
            }
            throw new Error("ambiguous transport close");
          },
          subscribeActivity() { return () => {}; },
          close() {},
        };
      },
    }, createGlobalAttemptScheduler(), fixture.journal, {
      measurement: {
        record(event) {
          measurement.push(event);
        },
      },
      activityIngestor: createActivityIngestor({ journal: fixture.journal }),
    });
    const started = await coordinator.start(CARD_ONE, "initial-secret");
    if (started.status !== "started") throw new Error("expected started attempt");
    for (let count = 0; count < 20 && promptCalls === 0; count += 1) await Promise.resolve();
    expect(await coordinator.submitCardPrompt({
      commandId: "submit-interrupted",
      boardId: BOARD_ID,
      cardId: CARD_ONE,
      expectedCardVersion: 2,
      source: "composer",
      content: "follow-up-secret",
      activeAttempt: {
        attemptId: started.attempt.attemptId,
        generation: started.attempt.generation,
      },
    })).toMatchObject({ status: "ok", outcome: "queued" });
    releaseInitial?.();
    for (
      let count = 0;
      count < 40 && fixture.journal.snapshot().followUpQueues[0]?.drafts[0]?.state !== "interrupted";
      count += 1
    ) await Promise.resolve();
    expect(fixture.journal.snapshot().followUpQueues[0]?.drafts[0]?.state).toBe("interrupted");
    expect(measurement).toEqual([{
      schemaVersion: 1,
      name: "safe_boundary_dispatch",
      outcome: "interrupted",
    }]);
    expect(JSON.stringify(measurement)).not.toContain("initial-secret");
    expect(JSON.stringify(measurement)).not.toContain("follow-up-secret");
  });
});

async function prepareReadyReview(fixture: ReturnType<typeof createFixture>): Promise<{
  readonly expectedCardVersion: number;
  readonly evidence: ReviewEvidencePrecondition;
}> {
  const coordinator = fixture.coordinator({
    async connect() {
      return {
        async newSession() { return { sessionId: "review-source-session" }; },
        async prompt() { return { stopReason: "end_turn" }; },
        subscribeActivity() { return () => {}; },
        close() {},
      };
    },
  });
  const started = await coordinator.start(CARD_ONE);
  if (started.status !== "started") throw new Error("failed to seed review source attempt");
  await coordinator.release(started.attempt.attemptId);
  const terminal = await createActivityIngestor({ journal: fixture.journal }).ingest({
    eventId: toOpaqueId<ActivityEventId>(`request-review-success-${crypto.randomUUID()}`)!,
    attemptId: started.attempt.attemptId,
    generation: started.attempt.generation,
    sequence: toActivitySequence(2)!,
    occurredAt: 200,
    activity: { kind: "attempt_state", state: "succeeded" },
  });
  if (terminal.status !== "committed") throw new Error("failed to settle review source attempt");

  const binding = started.context.worktree;
  fixture.journal.append({
    eventId: `request-review-binding-${crypto.randomUUID()}`,
    boardId: binding.boardId,
    cardId: binding.cardId,
    actor: "system",
    kind: "card_worktree_binding_recorded",
    occurredAt: 210,
    payload: binding,
  });
  const currentCard = fixture.journal.snapshot().cards.find(
    ({ cardId }) => cardId === CARD_ONE,
  )!;
  const patchBlob = new TextEncoder().encode("request changes review patch\n");
  const patchDigest = createHash("sha256").update(patchBlob).digest("hex");
  const evidenceId = `request-evidence-${crypto.randomUUID()}`;
  const evidence: ReviewEvidenceRecord = {
    evidenceId,
    boardId: currentCard.boardId,
    cardId: currentCard.cardId,
    attemptId: started.attempt.attemptId,
    generation: started.attempt.generation,
    worktreeBindingId: binding.bindingId,
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40),
    policyVersion: 1,
    evidenceDigest: createHash("sha256").update(evidenceId).digest("hex"),
    fileCount: 1,
    totalPatchBytes: patchBlob.byteLength,
    createdAt: 220,
    files: [{
      evidenceId,
      fileIndex: 0,
      fileId: "request-review-file",
      status: "modified",
      oldPath: "src/request.ts",
      newPath: "src/request.ts",
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
  const readyCard: CardProjection = {
    ...currentCard,
    executionStatus: "ready_for_review",
    version: currentCard.version + 1,
    updatedAt: evidence.createdAt,
  };
  fixture.journal.immediate((transaction) => {
    transaction.persistReviewEvidence(evidence);
    transaction.append({
      eventId: `evidence:${evidence.evidenceId}`,
      boardId: evidence.boardId,
      cardId: evidence.cardId,
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
  return {
    expectedCardVersion: readyCard.version,
    evidence: {
      evidenceId: evidence.evidenceId,
      evidenceDigest: evidence.evidenceDigest,
      attemptId: evidence.attemptId,
      generation: evidence.generation,
      worktreeBindingId: evidence.worktreeBindingId,
    },
  };
}

function currentEvidenceService(
  evidence: ReviewEvidencePrecondition,
): Pick<ReviewEvidenceService, "revalidate"> {
  return {
    async revalidate() {
      return {
        status: "current",
        evidenceId: evidence.evidenceId,
        evidenceDigest: evidence.evidenceDigest,
      };
    },
  };
}

function createFixture(cardIds: readonly CardId[]) {
  const database = openSqliteDatabase({ filename: ":memory:" });
  databases.push(database);
  migrateDatabase(database, { now: () => 1 });
  const journal = createEventJournal(database);
  seed(journal, cardIds);
  let currentCatalog = catalog(SKILL_ID, "Execute the card exactly once");
  let attemptNumber = 0;
  let eventNumber = 0;
  const binding = (cardId: CardId) => worktree(cardId);
  const profile: CertifiedDirectAcpProfile = {
    profileId: PROFILE_ID,
    provider: "codex",
    models: ["gpt-5"],
    efforts: ["high"],
    readiness: { profileId: PROFILE_ID, ready: true, protocolVersion: 1 },
    certification: { recipeId: "codex-acp", adapterVersion: "1.2.3", checkedAt: 50 },
  };
  return {
    database,
    journal,
    binding,
    get catalog() { return currentCatalog; },
    set catalog(value: SkillCatalog) { currentCatalog = value; },
    coordinator(
      factory: DirectAcpConnectionFactory,
      scheduler = createGlobalAttemptScheduler(),
      selectedJournal: EventJournal = journal,
      followUpOptions: {
        readonly hasActiveAttention?: (attemptId: AttemptId) => boolean;
        readonly measurement?: WorkflowMeasurementSink;
        readonly askUserBridge?: Pick<AttemptAskUserBridge, "register" | "revoke">;
        readonly activityIngestor?: AttemptActivityIngestor;
        readonly reviewEvidence?: Pick<ReviewEvidenceService, "revalidate">;
        readonly diagnostics?: LifecycleDiagnostics;
      } = {},
    ) {
      return createAttemptCoordinator({
        journal: selectedJournal,
        scheduler,
        worktrees: {
          async ensure({ cardId }) {
            return { status: "reused", binding: binding(cardId) };
          },
          async cleanupExplicit() {
            return { status: "refused", reason: "live" };
          },
        },
        directAcp: createDirectAcpAttemptStarter(factory),
        getCatalog: () => currentCatalog,
        resolveProfile: () => profile,
        verifyRepository: () => ({
          trusted: true,
          canonicalPath: REPOSITORY,
          checkedAt: 50,
          message: "Trusted repository identity verified",
        }),
        now: () => 100 + eventNumber,
        createAttemptId: () => `attempt-${++attemptNumber}`,
        createEventId: (operation) => `attempt-event-${operation}-${++eventNumber}`,
        createFollowUpEventId: (operation) => `follow-up-event-${operation}-${++eventNumber}`,
        ...followUpOptions,
      });
    },
  };
}

function seed(journal: EventJournal, cardIds: readonly CardId[]): void {
  journal.append({
    eventId: "seed-board",
    boardId: BOARD_ID,
    actor: "operator",
    kind: "board_upserted",
    occurredAt: 1,
    payload: {
      boardId: BOARD_ID,
      repositoryPath: REPOSITORY,
      workflowVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  });
  journal.append({
    eventId: "seed-stage",
    boardId: BOARD_ID,
    actor: "operator",
    kind: "stage_upserted",
    occurredAt: 2,
    payload: {
      stageId: STAGE_ID,
      boardId: BOARD_ID,
      label: "Doing",
      position: 0,
      defaultSkillId: SKILL_ID,
      configured: true,
      workflowVersion: 1,
      updatedAt: 2,
    },
  });
  cardIds.forEach((cardId, index) => journal.append({
    eventId: `seed-card-${index}`,
    boardId: BOARD_ID,
    cardId,
    actor: "operator",
    kind: "card_upserted",
    occurredAt: 3 + index,
    payload: card(cardId, 3 + index),
  }));
}

function card(cardId: CardId, createdAt: number): CardProjection {
  return {
    cardId,
    boardId: BOARD_ID,
    stageId: STAGE_ID,
    title: `Card ${cardId}`,
    description: "Implement the requested change",
    provider: "codex",
    model: "gpt-5",
    effort: "high",
    skillOverrideId: null,
    runnable: true,
    executionStatus: "idle",
    version: 1,
    createdAt,
    updatedAt: createdAt,
  };
}

function catalog(skillId: SkillId, content: string): SkillCatalog {
  const digest = skillId.slice("skill:".length);
  const entry: SkillCatalogEntry = {
    skillId,
    canonicalPath: `/tmp/skills/${digest}/SKILL.md`,
    rootClass: "project",
    rootPath: "/tmp/skills",
    digest,
    metadata: { name: `skill-${digest[0]}`, description: "Fixture", frontmatter: { name: `skill-${digest[0]}` } },
    order: 0,
    hasNameCollision: false,
    diagnostics: [],
  };
  return {
    roots: [],
    entries: [entry],
    diagnostics: [],
    resolvedSkills: new Map([[skillId, { entry, validatedContent: content }]]),
  };
}

function worktree(cardId: CardId): CardWorktreeBinding {
  const suffix = cardId === CARD_ONE ? "kw-attemptone01" : "kw-attempttwo02";
  return {
    bindingVersion: 1,
    bindingId: suffix,
    boardId: BOARD_ID,
    cardId,
    repositoryRoot: REPOSITORY,
    repositoryGitDir: `${REPOSITORY}/.git`,
    managedRoot: `${REPOSITORY}/.kitten/worktrees/cards`,
    worktreePath: `${REPOSITORY}/.kitten/worktrees/cards/${suffix}`,
    branch: `kitten/card/${suffix}`,
    baselineBranch: "main",
    baselineCommit: "b".repeat(40),
    lifecycle: "active",
    reason: null,
    createdAt: 50,
    updatedAt: 50,
  };
}

function assertCreated(journal: EventJournal, cardId: CardId): void {
  const snapshot = journal.snapshot();
  expect(snapshot.cards.find((card) => card.cardId === cardId)?.executionStatus).toBe("running");
  expect(snapshot.attempts.at(-1)?.state).toBe("starting");
  expect(snapshot.runContexts.at(-1)?.card.cardId).toBe(cardId);
  expect(lifecycleOperations(journal).at(-1)).toBe("created");
}

function lifecycleOperations(journal: EventJournal): string[] {
  return journal.events()
    .filter((event): event is Extract<JournalEvent, { kind: "attempt_lifecycle_committed" }> => (
      event.kind === "attempt_lifecycle_committed"
    ))
    .map((event) => event.payload.operation);
}

function mutateStageAndCard(journal: EventJournal, cardId: CardId, skillId: SkillId): void {
  const snapshot = journal.snapshot();
  const stage = snapshot.stages[0];
  const current = snapshot.cards.find((candidate) => candidate.cardId === cardId);
  if (stage === undefined || current === undefined) throw new Error("fixture projections missing");
  journal.append({
    eventId: "mutate-stage",
    boardId: BOARD_ID,
    actor: "operator",
    kind: "stage_upserted",
    occurredAt: 500,
    payload: { ...stage, defaultSkillId: skillId, workflowVersion: 2, updatedAt: 500 },
  });
  journal.append({
    eventId: "mutate-card",
    boardId: BOARD_ID,
    cardId,
    actor: "operator",
    kind: "card_upserted",
    occurredAt: 501,
    payload: { ...current, title: "Changed after start", version: current.version + 1, updatedAt: 501 },
  });
}
