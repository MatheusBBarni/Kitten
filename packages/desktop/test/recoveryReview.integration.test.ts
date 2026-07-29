import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  toActivitySequence,
  toAttemptGeneration,
  toOpaqueId,
  type ActivityEventId,
  type AttemptId,
  type ProfileId,
} from "@kitten/engine";
import { createActivityIngestor } from "../src/attempts/activityIngestor.ts";
import {
  completeSuccessfulAttempt,
  createAttemptCoordinator,
} from "../src/attempts/attemptCoordinator.ts";
import type {
  CertifiedDirectAcpProfile,
  RunContext,
} from "../src/attempts/contracts.ts";
import { createDirectAcpAttemptStarter, type DirectAcpConnectionFactory } from "../src/attempts/directAcpAttempt.ts";
import { createFollowUpQueue, type FollowUpQueueId } from "../src/attempts/followUpQueue.ts";
import { createGlobalAttemptScheduler } from "../src/attempts/scheduler.ts";
import { createAttemptAskUserBridge, AttemptAskUserBridgeError } from "../src/attention/attemptAskUserBridge.ts";
import { createAttentionCoordinator, AttentionCoordinatorError } from "../src/attention/attentionCoordinator.ts";
import {
  ATTENTION_ATTEMPT_ID,
  ATTENTION_BOARD_ID,
  ATTENTION_CARD_ID,
  ATTENTION_FORM,
  ATTENTION_GENERATION,
  seedAttentionAttempt,
} from "../src/attention/testSupport.ts";
import type { SkillCatalog } from "../src/catalog/contracts.ts";
import { createDesktopCoordinator } from "../src/host/desktopCoordinator.ts";
import { createDesktopReviewRpc } from "../src/host/desktopRpc.ts";
import { createReviewDispositionService } from "../src/host/reviewDisposition.ts";
import { createReviewEvidenceService } from "../src/host/reviewEvidence.ts";
import { startDesktopShell, type DesktopWindowFactory } from "../src/main.ts";
import { createCardNotificationService } from "../src/notifications/cardNotificationService.ts";
import {
  createEventJournal,
  type EventJournal,
  type ReviewEvidenceRecord,
} from "../src/persistence/eventJournal.ts";
import { migrateDatabase } from "../src/persistence/migrations.ts";
import { rebuildProjections } from "../src/persistence/projectionRebuilder.ts";
import { closeSqliteDatabase, openSqliteDatabase } from "../src/persistence/sqliteDatabase.ts";
import type { HostMessageEnvelope } from "../src/shared/rpc.ts";
import type { CardWorktreeBinding } from "../src/worktrees/contracts.ts";
import { createWorkflowCommandHandler } from "../src/workflow/workflowCommands.ts";
import {
  workflowIds,
  type CardProjection,
} from "../src/workflow/workflowTypes.ts";

const temporaryDirectories: string[] = [];
const lifecycleDatabases: ReturnType<typeof openSqliteDatabase>[] = [];
afterEach(() => {
  while (lifecycleDatabases.length > 0) {
    closeSqliteDatabase(lifecycleDatabases.pop()!);
  }
  while (temporaryDirectories.length > 0) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
});

function openLifecycleDatabase(filename: string) {
  const database = openSqliteDatabase({ filename });
  lifecycleDatabases.push(database);
  return database;
}

function closeLifecycleDatabase(database: ReturnType<typeof openSqliteDatabase>): void {
  const index = lifecycleDatabases.indexOf(database);
  if (index >= 0) lifecycleDatabases.splice(index, 1);
  closeSqliteDatabase(database);
}

describe("interrupted recovery and explicit review integration", () => {
  test("restarts honestly, rejects stale routes, starts fresh, retains the worktree, and completes only via reviewCard", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kitten-recovery-review-"));
    temporaryDirectories.push(directory);
    const filename = join(directory, "desktop.sqlite");
    let database = openSqliteDatabase({ filename });
    migrateDatabase(database, { now: () => 1 });
    let journal = createEventJournal(database);
    seedAttentionAttempt(journal);
    const originalContext = journal.snapshot().runContexts[0]!;
    const binding = originalContext.worktree;
    journal.append({
      eventId: "recovery-worktree-binding",
      boardId: binding.boardId,
      cardId: binding.cardId,
      actor: "system",
      kind: "card_worktree_binding_recorded",
      occurredAt: 102,
      payload: binding,
    });
    const queue = createFollowUpQueue({
      boardId: ATTENTION_BOARD_ID,
      cardId: ATTENTION_CARD_ID,
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      queueId: "queue-before-restart" as FollowUpQueueId,
      text: "queued transcript content must remain local",
      occurredAt: 103,
    });
    journal.append({
      eventId: "recovery-queue",
      boardId: ATTENTION_BOARD_ID,
      cardId: ATTENTION_CARD_ID,
      actor: "operator",
      kind: "follow_up_queue_committed",
      occurredAt: 103,
      payload: { operation: "enqueued", queue },
    });
    const attention = createAttentionCoordinator({
      journal,
      notifications: createCardNotificationService({ deliver() {}, now: () => 105 }),
      now: () => 104,
      createBlockerId: () => "blocker-before-restart",
      createEventId: (operation) => `recovery-attention-${operation}`,
    });
    const bridge = createAttemptAskUserBridge({
      journal,
      attention,
      createCapability: () => "a".repeat(48),
    });
    const staleRoute = bridge.register({ attemptId: ATTENTION_ATTEMPT_ID, generation: ATTENTION_GENERATION });
    const raised = await attention.raise({
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      callId: "call-before-restart",
      form: ATTENTION_FORM,
    });

    let unexpectedAcpStarts = 0;
    const desktop = createDesktopCoordinator({
      journal,
      evidence: {
        async revalidate() {
          return { status: "unavailable", reason: "missing" };
        },
      },
      now: () => 200,
    });
    expect(desktop.start().interruptedAttemptIds).toEqual([ATTENTION_ATTEMPT_ID]);
    expect(unexpectedAcpStarts).toBe(0);
    await expect(bridge.forward({
      capability: staleRoute.capability,
      callId: "stale-after-restart",
      form: ATTENTION_FORM,
    })).rejects.toMatchObject({ code: "unavailable", reason: "attempt_stale_or_terminal" } satisfies Partial<AttemptAskUserBridgeError>);
    expect(() => attention.resolve({
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      blockerId: raised.blocker.blockerId,
      expectedVersion: raised.blocker.version + 1,
      outcome: { kind: "skipped" },
    })).toThrow(AttentionCoordinatorError);
    const afterRecovery = journal.snapshot();
    expect(afterRecovery.attempts[0]).toMatchObject({ state: "interrupted", sessionId: "session-attention" });
    expect(afterRecovery.cards[0]).toMatchObject({ executionStatus: "failed", stageId: originalContext.stage.stageId });
    expect(afterRecovery.runContexts).toEqual([originalContext]);
    expect(afterRecovery.followUpQueues).toEqual([queue]);
    expect(afterRecovery.attentionBlockers[0]).toMatchObject({ active: false, outcome: { kind: "cancelled" } });
    expect(afterRecovery.cardWorktrees).toEqual([binding]);

    closeSqliteDatabase(database);
    database = openSqliteDatabase({ filename });
    migrateDatabase(database);
    journal = createEventJournal(database);
    const reopened = journal.snapshot();
    expect(rebuildProjections(database)).toEqual(reopened);
    expect(journal.snapshot().attemptInspectors[0]).toMatchObject({ terminalOutcome: "interrupted" });

    const prompts: string[] = [];
    let emitActivity: (input: unknown) => Promise<void> = async () => { throw new Error("not subscribed"); };
    const sessions: string[] = [];
    const factory: DirectAcpConnectionFactory = {
      async connect() {
        unexpectedAcpStarts += 1;
        return {
          async newSession() {
            const sessionId = `fresh-session-${sessions.length + 1}`;
            sessions.push(sessionId);
            return { sessionId };
          },
          async prompt({ prompt }) { prompts.push(prompt); return { stopReason: "end_turn" }; },
          subscribeActivity(listener) {
            emitActivity = async (input) => { await listener(input); };
            return () => {};
          },
          close() {},
        };
      },
    };
    const ingestor = createActivityIngestor({ journal });
    let cleanupCalls = 0;
    const coordinator = createAttemptCoordinator({
      journal,
      scheduler: createGlobalAttemptScheduler(),
      worktrees: {
        async ensure() { return { status: "reused", binding }; },
        async cleanupExplicit() { cleanupCalls += 1; return { status: "refused", reason: "live" }; },
      },
      directAcp: createDirectAcpAttemptStarter(factory),
      activityIngestor: ingestor,
      getCatalog: () => catalogFrom(originalContext),
      resolveProfile: () => profileFrom(originalContext),
      verifyRepository: () => originalContext.repository,
      now: (() => { let value = 300; return () => ++value; })(),
      createAttemptId: () => "attempt-after-restart",
      createEventId: (operation) => `later-${operation}`,
    });
    const recoveredCard = journal.snapshot().cards.find(
      ({ cardId }) => cardId === ATTENTION_CARD_ID,
    )!;
    expect(await coordinator.submitCardPrompt({
      commandId: "retry-after-restart",
      boardId: ATTENTION_BOARD_ID,
      cardId: ATTENTION_CARD_ID,
      expectedCardVersion: recoveredCard.version,
      source: "composer",
      content: "Do not resend the interrupted prompt automatically",
      activeAttempt: {
        attemptId: ATTENTION_ATTEMPT_ID,
        generation: ATTENTION_GENERATION,
      },
    })).toMatchObject({ status: "rejected" });
    expect(prompts).toEqual([]);

    const started = await coordinator.start(ATTENTION_CARD_ID);
    expect(started.status).toBe("started");
    if (started.status !== "started") throw new Error("later attempt did not start");
    expect(started.sessionId).toBe("fresh-session-1");
    expect(started.sessionId).not.toBe("session-attention");
    expect(started.context.worktree).toEqual(binding);
    expect(journal.snapshot().runContexts).toHaveLength(2);
    expect(journal.snapshot().runContexts[0]).toEqual(originalContext);
    expect(unexpectedAcpStarts).toBe(1);

    await emitActivity({
      eventId: toOpaqueId<ActivityEventId>("later-success")!,
      attemptId: started.attempt.attemptId,
      generation: started.attempt.generation,
      sequence: toActivitySequence(2)!,
      occurredAt: 310,
      activity: { kind: "attempt_state", state: "succeeded" },
    });
    const runningCard = journal.snapshot().cards[0]!;
    const board = journal.snapshot().boards[0]!;
    const transition = createWorkflowCommandHandler(journal, { now: () => 311 }).execute({
      kind: "record_agent_success",
      mutationId: workflowIds.mutation("later-agent-success"),
      boardId: board.boardId,
      cardId: runningCard.cardId,
      expectedWorkflowVersion: board.workflowVersion,
      expectedCardVersion: runningCard.version,
    });
    expect(transition.status).toBe("committed");
    const ready = journal.snapshot().cards[0]!;
    expect(ready.executionStatus).toBe("ready_for_review");
    const evidence = seedReviewEvidence(journal, ready.version);

    const reviewService = createReviewDispositionService({
      journal,
      evidence: {
        async revalidate() {
          return {
            status: "current",
            evidenceId: evidence.evidenceId,
            evidenceDigest: evidence.evidenceDigest,
          };
        },
      },
      now: () => 320,
    });
    const reviewRpc = createDesktopReviewRpc(reviewService);
    const windowFactory = new ReviewWindowFactory();
    startDesktopShell({ windowFactory, reviewRpc });
    const reviewResult = await windowFactory.review!({
      commandId: "rpc-review-command",
      boardId: ready.boardId,
      cardId: ready.cardId,
      expectedCardVersion: ready.version,
      disposition: "approved",
      evidence: {
        evidenceId: evidence.evidenceId,
        evidenceDigest: evidence.evidenceDigest,
        attemptId: evidence.attemptId,
        generation: evidence.generation,
        worktreeBindingId: evidence.worktreeBindingId,
      },
    });
    expect(reviewResult.result).toMatchObject({ status: "ok", outcome: "approved" });
    expect(journal.snapshot().cards[0]!.executionStatus).toBe("completed");
    expect(journal.snapshot().reviewDispositions).toHaveLength(1);
    const completed = journal.snapshot();
    expect(rebuildProjections(database)).toEqual(completed);
    expect(windowFactory.messages).toEqual([{
      kind: "projection_committed",
      messageId: "review:rpc-review-command",
      revision: journal.snapshot().revision,
    }]);
    expect(cleanupCalls).toBe(0);
    expect(prompts).toEqual([]);
    bridge.dispose();
    closeSqliteDatabase(database);
  });
});

describe("evidence-gated final-stage lifecycle", () => {
  test("captures from the isolated worktree, survives SQLite reopen, and approves without delivery or cleanup", async () => {
    const fixture = await createEvidenceLifecycleFixture();
    writeFileSync(join(fixture.binding.worktreePath, "tracked.txt"), "captured change\n");
    const remoteRefsBefore = gitRefs(fixture.remote);
    const completion = await completeSuccessfulAttempt({
      journal: fixture.journal,
      workflowCommands: createWorkflowCommandHandler(fixture.journal),
      reviewEvidence: createReviewEvidenceService(fixture.journal, { now: () => 200 }),
      attemptId: EVIDENCE_ATTEMPT_ID,
      generation: EVIDENCE_GENERATION,
      createMutationId: () => workflowIds.mutation("unused-final-stage"),
    });
    expect(completion.status).toBe("ready_for_review");
    if (completion.status !== "ready_for_review") {
      throw new Error(`capture failed: ${JSON.stringify(completion)}`);
    }
    expect(fixture.journal.snapshot().cards[0]).toMatchObject({
      executionStatus: "ready_for_review",
      version: 3,
    });
    expect(fixture.journal.snapshot().reviewEvidenceByCard[EVIDENCE_CARD_ID]).toMatchObject({
      evidenceId: completion.evidenceId,
      evidenceDigest: completion.evidenceDigest,
      boardId: EVIDENCE_BOARD_ID,
      cardId: EVIDENCE_CARD_ID,
      attemptId: EVIDENCE_ATTEMPT_ID,
      generation: EVIDENCE_GENERATION,
      worktreeBindingId: fixture.binding.bindingId,
      baseCommit: fixture.binding.baselineCommit,
      policyVersion: 1,
    });

    closeLifecycleDatabase(fixture.database);
    const reopenedDatabase = openLifecycleDatabase(fixture.filename);
    fixture.database = reopenedDatabase;
    migrateDatabase(reopenedDatabase);
    const reopenedJournal = createEventJournal(reopenedDatabase);
    const evidence = reopenedJournal.reviewEvidence(completion.evidenceId)!;
    const evidenceService = createReviewEvidenceService(reopenedJournal);
    const approval = await createReviewDispositionService({
      journal: reopenedJournal,
      evidence: evidenceService,
      now: () => 220,
    }).reviewCard({
      commandId: "approve-after-reopen",
      boardId: EVIDENCE_BOARD_ID,
      cardId: EVIDENCE_CARD_ID,
      expectedCardVersion: completion.cardVersion,
      disposition: "approved",
      evidence: {
        evidenceId: evidence.evidenceId,
        evidenceDigest: evidence.evidenceDigest,
        attemptId: evidence.attemptId,
        generation: evidence.generation,
        worktreeBindingId: evidence.worktreeBindingId,
      },
    });
    expect(approval).toEqual({
      status: "ok",
      outcome: "approved",
      cardVersion: 4,
    });
    expect(reopenedJournal.snapshot().cards[0]).toMatchObject({
      executionStatus: "completed",
      version: 4,
    });
    expect(reopenedJournal.snapshot().reviewDispositions).toHaveLength(1);
    expect(existsSync(fixture.binding.worktreePath)).toBeTrue();
    expect(runGit(fixture.binding.worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]))
      .toBe(fixture.binding.branch);
    expect(gitRefs(fixture.remote)).toEqual(remoteRefsBefore);
  });

  test("admits Request changes before one ACP send and rebuilds without ambiguous restart resend", async () => {
    const fixture = await createEvidenceLifecycleFixture();
    writeFileSync(join(fixture.binding.worktreePath, "tracked.txt"), "reviewed correction target\n");
    const evidenceService = createReviewEvidenceService(fixture.journal, { now: () => 200 });
    const completion = await completeSuccessfulAttempt({
      journal: fixture.journal,
      workflowCommands: createWorkflowCommandHandler(fixture.journal),
      reviewEvidence: evidenceService,
      attemptId: EVIDENCE_ATTEMPT_ID,
      generation: EVIDENCE_GENERATION,
    });
    if (completion.status !== "ready_for_review") {
      throw new Error(`request-changes setup failed: ${JSON.stringify(completion)}`);
    }
    const evidence = fixture.journal.reviewEvidence(completion.evidenceId)!;
    const originalContext = fixture.journal.snapshot().runContexts[0]!;
    const observations: string[] = [];
    const prompts: string[] = [];
    let ensureCalls = 0;
    const coordinator = createAttemptCoordinator({
      journal: fixture.journal,
      scheduler: createGlobalAttemptScheduler(),
      worktrees: {
        async ensure() {
          ensureCalls += 1;
          return { status: "unavailable", reason: "dirty" };
        },
        async cleanupExplicit() {
          return { status: "refused", reason: "live" };
        },
      },
      directAcp: createDirectAcpAttemptStarter({
        async connect() {
          observations.push("connect");
          expect(fixture.journal.snapshot().reviewDispositions).toEqual([
            expect.objectContaining({ disposition: "changes_requested" }),
          ]);
          expect(fixture.journal.snapshot().attempts.at(-1)).toMatchObject({
            attemptId: "attempt-evidence-replacement",
            generation: 2,
            state: "starting",
          });
          return {
            async newSession() {
              observations.push("newSession");
              expect(fixture.journal.snapshot().runContexts).toHaveLength(2);
              return { sessionId: "session-evidence-replacement" };
            },
            async prompt({ prompt }) {
              observations.push("prompt");
              expect(fixture.journal.snapshot().reviewDispositions).toHaveLength(1);
              expect(fixture.journal.snapshot().attempts.at(-1)?.state).toBe("running");
              prompts.push(prompt);
              return { stopReason: "end_turn" };
            },
            subscribeActivity() { return () => {}; },
            close() {},
          };
        },
      }),
      reviewEvidence: evidenceService,
      getCatalog: () => catalogFrom(originalContext),
      resolveProfile: () => profileFrom(originalContext),
      verifyRepository: () => ({
        trusted: true,
        canonicalPath: fixture.binding.repositoryRoot,
        checkedAt: 225,
        message: "verified",
      }),
      now: () => 230,
      createAttemptId: () => "attempt-evidence-replacement",
      createEventId: (operation) => `request-changes-${operation}`,
    });
    const requestText = "Address the evidence-bound review findings";
    const result = await coordinator.submitCardPrompt({
      commandId: "request-changes-reopen",
      boardId: EVIDENCE_BOARD_ID,
      cardId: EVIDENCE_CARD_ID,
      expectedCardVersion: completion.cardVersion,
      source: "request_changes",
      content: requestText,
      evidence: {
        evidenceId: evidence.evidenceId,
        evidenceDigest: evidence.evidenceDigest,
        attemptId: evidence.attemptId,
        generation: evidence.generation,
        worktreeBindingId: evidence.worktreeBindingId,
      },
    });
    expect(result).toEqual({
      status: "ok",
      outcome: "admitted",
      cardVersion: completion.cardVersion + 1,
      attemptId: "attempt-evidence-replacement" as AttemptId,
      generation: toAttemptGeneration(2)!,
    });
    expect(ensureCalls).toBe(0);
    for (let count = 0; count < 40 && prompts.length === 0; count += 1) {
      await Promise.resolve();
    }
    expect(observations).toEqual(["connect", "newSession", "prompt"]);
    expect(prompts).toEqual([requestText]);
    expect(fixture.journal.snapshot().cards).toHaveLength(1);
    expect(fixture.journal.snapshot().cards[0]).toMatchObject({
      boardId: EVIDENCE_BOARD_ID,
      cardId: EVIDENCE_CARD_ID,
      stageId: EVIDENCE_STAGE_ID,
      executionStatus: "running",
    });
    expect(rebuildProjections(fixture.database)).toEqual(fixture.journal.snapshot());
    await coordinator.release("attempt-evidence-replacement" as AttemptId);

    closeLifecycleDatabase(fixture.database);
    const reopenedDatabase = openLifecycleDatabase(fixture.filename);
    fixture.database = reopenedDatabase;
    migrateDatabase(reopenedDatabase);
    const reopenedJournal = createEventJournal(reopenedDatabase);
    const reopened = reopenedJournal.snapshot();
    expect(reopened.reviewDispositions).toEqual([
      expect.objectContaining({
        reviewId: "request-changes-reopen",
        disposition: "changes_requested",
        attemptId: EVIDENCE_ATTEMPT_ID,
        generation: EVIDENCE_GENERATION,
      }),
    ]);
    expect(reopened.attempts.at(-1)).toMatchObject({
      attemptId: "attempt-evidence-replacement",
      generation: 2,
      state: "running",
    });
    expect(reopened.runContexts).toHaveLength(2);
    expect(rebuildProjections(reopenedDatabase)).toEqual(reopened);
    const recovery = createDesktopCoordinator({
      journal: reopenedJournal,
      evidence: createReviewEvidenceService(reopenedJournal),
      now: () => 240,
    }).start();
    expect(recovery.interruptedAttemptIds).toEqual([
      "attempt-evidence-replacement" as AttemptId,
    ]);
    expect(reopenedJournal.snapshot().attempts.at(-1)?.state).toBe("interrupted");
    expect(prompts).toEqual([requestText]);
  });

  test("retains admitted Request changes and follows failed-attempt behavior after ACP startup failure", async () => {
    const fixture = await createEvidenceLifecycleFixture();
    writeFileSync(join(fixture.binding.worktreePath, "tracked.txt"), "reviewed startup failure\n");
    const evidenceService = createReviewEvidenceService(fixture.journal, { now: () => 200 });
    const completion = await completeSuccessfulAttempt({
      journal: fixture.journal,
      workflowCommands: createWorkflowCommandHandler(fixture.journal),
      reviewEvidence: evidenceService,
      attemptId: EVIDENCE_ATTEMPT_ID,
      generation: EVIDENCE_GENERATION,
    });
    if (completion.status !== "ready_for_review") {
      throw new Error(`startup-failure setup failed: ${JSON.stringify(completion)}`);
    }
    const evidence = fixture.journal.reviewEvidence(completion.evidenceId)!;
    const originalContext = fixture.journal.snapshot().runContexts[0]!;
    let connectCalls = 0;
    const coordinator = createAttemptCoordinator({
      journal: fixture.journal,
      scheduler: createGlobalAttemptScheduler(),
      worktrees: {
        async ensure() {
          throw new Error("request changes must reuse the evidence binding");
        },
        async cleanupExplicit() {
          return { status: "refused", reason: "live" };
        },
      },
      directAcp: createDirectAcpAttemptStarter({
        async connect() {
          connectCalls += 1;
          expect(fixture.journal.snapshot().reviewDispositions).toHaveLength(1);
          throw new Error("simulated post-commit connection failure");
        },
      }),
      reviewEvidence: evidenceService,
      getCatalog: () => catalogFrom(originalContext),
      resolveProfile: () => profileFrom(originalContext),
      verifyRepository: () => ({
        trusted: true,
        canonicalPath: fixture.binding.repositoryRoot,
        checkedAt: 225,
        message: "verified",
      }),
      now: (() => {
        let value = 230;
        return () => ++value;
      })(),
      createAttemptId: () => "attempt-evidence-startup-failed",
      createEventId: (operation) => `request-startup-failure-${operation}`,
    });
    const result = await coordinator.submitCardPrompt({
      commandId: "request-changes-startup-failure",
      boardId: EVIDENCE_BOARD_ID,
      cardId: EVIDENCE_CARD_ID,
      expectedCardVersion: completion.cardVersion,
      source: "request_changes",
      content: "Retry these review findings in a fresh attempt",
      evidence: {
        evidenceId: evidence.evidenceId,
        evidenceDigest: evidence.evidenceDigest,
        attemptId: evidence.attemptId,
        generation: evidence.generation,
        worktreeBindingId: evidence.worktreeBindingId,
      },
    });
    expect(result).toMatchObject({
      status: "ok",
      outcome: "admitted",
      attemptId: "attempt-evidence-startup-failed",
      generation: 2,
    });
    expect(connectCalls).toBe(1);
    expect(fixture.journal.snapshot().reviewDispositions).toEqual([
      expect.objectContaining({ disposition: "changes_requested" }),
    ]);
    expect(fixture.journal.snapshot().attempts.at(-1)).toMatchObject({
      attemptId: "attempt-evidence-startup-failed",
      generation: 2,
      state: "failed",
      failure: { code: "connection_failed" },
    });
    expect(fixture.journal.snapshot().cards[0]).toMatchObject({
      cardId: EVIDENCE_CARD_ID,
      stageId: EVIDENCE_STAGE_ID,
      executionStatus: "failed",
      version: completion.cardVersion + 2,
    });
    expect(fixture.journal.snapshot().runContexts).toHaveLength(2);
    expect(rebuildProjections(fixture.database)).toEqual(fixture.journal.snapshot());
  });

  test("rejects approval after tracked, dirty, or eligible untracked content changes", async () => {
    const mutations: ReadonlyArray<{
      readonly name: string;
      readonly mutate: (fixture: EvidenceLifecycleFixture) => void;
    }> = [
      {
        name: "tracked commit",
        mutate(fixture) {
          writeFileSync(join(fixture.binding.worktreePath, "tracked.txt"), "committed later\n");
          runGit(fixture.binding.worktreePath, ["add", "tracked.txt"]);
          runGit(fixture.binding.worktreePath, ["commit", "-m", "later tracked change"]);
        },
      },
      {
        name: "dirty tracked file",
        mutate(fixture) {
          writeFileSync(join(fixture.binding.worktreePath, "tracked.txt"), "dirty later\n");
        },
      },
      {
        name: "eligible untracked file",
        mutate(fixture) {
          writeFileSync(join(fixture.binding.worktreePath, "later.txt"), "untracked later\n");
        },
      },
    ];

    for (const mutation of mutations) {
      const fixture = await createEvidenceLifecycleFixture();
      writeFileSync(join(fixture.binding.worktreePath, "tracked.txt"), "captured change\n");
      const evidenceService = createReviewEvidenceService(fixture.journal, { now: () => 200 });
      const completion = await completeSuccessfulAttempt({
        journal: fixture.journal,
        workflowCommands: createWorkflowCommandHandler(fixture.journal),
        reviewEvidence: evidenceService,
        attemptId: EVIDENCE_ATTEMPT_ID,
        generation: EVIDENCE_GENERATION,
      });
      if (completion.status !== "ready_for_review") {
        throw new Error(`${mutation.name} setup capture failed`);
      }
      const evidence = fixture.journal.reviewEvidence(completion.evidenceId)!;
      mutation.mutate(fixture);
      const result = await createReviewDispositionService({
        journal: fixture.journal,
        evidence: evidenceService,
      }).reviewCard({
        commandId: `stale-${mutation.name}`,
        boardId: EVIDENCE_BOARD_ID,
        cardId: EVIDENCE_CARD_ID,
        expectedCardVersion: completion.cardVersion,
        disposition: "approved",
        evidence: {
          evidenceId: evidence.evidenceId,
          evidenceDigest: evidence.evidenceDigest,
          attemptId: evidence.attemptId,
          generation: evidence.generation,
          worktreeBindingId: evidence.worktreeBindingId,
        },
      });
      expect(result, mutation.name).toEqual({
        status: "rejected",
        error: { code: "evidence_stale", recoveryHint: "reload_evidence" },
      });
      expect(fixture.journal.snapshot().cards[0]?.executionStatus, mutation.name)
        .toBe("ready_for_review");
      expect(fixture.journal.snapshot().reviewDispositions, mutation.name).toEqual([]);
    }
  });

  test("rolls back evidence, journal reference, and readiness after an injected SQLite failure", async () => {
    const fixture = await createEvidenceLifecycleFixture();
    writeFileSync(join(fixture.binding.worktreePath, "tracked.txt"), "captured change\n");
    const failingJournal: EventJournal = {
      append: fixture.journal.append,
      appendBatch: fixture.journal.appendBatch,
      snapshot: fixture.journal.snapshot,
      events: fixture.journal.events,
      eventById: fixture.journal.eventById,
      reviewEvidence: fixture.journal.reviewEvidence,
      reviewEvidenceManifest: fixture.journal.reviewEvidenceManifest,
      reviewEvidenceFile: fixture.journal.reviewEvidenceFile,
      immediate(callback) {
        return fixture.journal.immediate((transaction) => callback({
          append: transaction.append,
          persistReviewEvidence(input) {
            transaction.persistReviewEvidence(input);
            throw new Error("injected SQLite failure");
          },
        }));
      },
    };
    const result = await completeSuccessfulAttempt({
      journal: failingJournal,
      workflowCommands: createWorkflowCommandHandler(failingJournal),
      reviewEvidence: createReviewEvidenceService(failingJournal, { now: () => 200 }),
      attemptId: EVIDENCE_ATTEMPT_ID,
      generation: EVIDENCE_GENERATION,
    });
    expect(result).toEqual({
      status: "non_reviewable",
      reason: "incomplete",
      error: { code: "evidence_unsafe", recoveryHint: "resolve_unsafe_change" },
    });
    expect(fixture.journal.snapshot().cards[0]).toMatchObject({
      executionStatus: "running",
      version: 2,
    });
    expect(fixture.journal.snapshot().reviewEvidenceByCard).toEqual({});
    expect(fixture.journal.events().some(({ kind }) => kind === "review_evidence_committed"))
      .toBeFalse();

    closeLifecycleDatabase(fixture.database);
    const reopened = openLifecycleDatabase(fixture.filename);
    fixture.database = reopened;
    const reopenedJournal = createEventJournal(reopened);
    expect(reopenedJournal.snapshot().cards[0]?.executionStatus).toBe("running");
    expect(reopenedJournal.snapshot().reviewEvidenceByCard).toEqual({});
  });
});

const EVIDENCE_BOARD_ID = workflowIds.board("board-evidence-lifecycle");
const EVIDENCE_STAGE_ID = workflowIds.stage("stage-evidence-final");
const EVIDENCE_CARD_ID = workflowIds.card("card-evidence-lifecycle");
const EVIDENCE_ATTEMPT_ID = toOpaqueId<AttemptId>("attempt-evidence-lifecycle")!;
const EVIDENCE_GENERATION = toAttemptGeneration(1)!;
const EVIDENCE_SKILL_ID = workflowIds.skill(`skill:${"e".repeat(64)}`);
const EVIDENCE_BINDING_ID = "kw-evidence000001";

interface EvidenceLifecycleFixture {
  database: ReturnType<typeof openSqliteDatabase>;
  readonly filename: string;
  readonly journal: EventJournal;
  readonly binding: CardWorktreeBinding;
  readonly remote: string;
}

function runGit(cwd: string, args: readonly string[]): string {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`Git fixture command failed: ${args.join(" ")}`);
  }
  return result.stdout.toString().replace(/\r?\n$/u, "");
}

function gitRefs(gitDirectory: string): string[] {
  const result = Bun.spawnSync({
    cmd: [
      "git",
      "--git-dir",
      gitDirectory,
      "for-each-ref",
      "--format=%(refname):%(objectname)",
    ],
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error("Could not inspect remote refs");
  return result.stdout.toString().trim().split(/\r?\n/u).filter(Boolean);
}

function evidenceRunContext(binding: CardWorktreeBinding): RunContext {
  return {
    schemaVersion: 1,
    attemptId: EVIDENCE_ATTEMPT_ID,
    generation: EVIDENCE_GENERATION,
    capturedAt: 100,
    card: {
      cardId: EVIDENCE_CARD_ID,
      title: "Evidence lifecycle",
      description: "Fixture",
      version: 1,
    },
    stage: { stageId: EVIDENCE_STAGE_ID, label: "Final" },
    workflow: { boardId: EVIDENCE_BOARD_ID, version: 1 },
    skill: {
      snapshotId: EVIDENCE_SKILL_ID,
      skillId: EVIDENCE_SKILL_ID,
      canonicalPath: join(binding.repositoryRoot, ".agents/skills/fixture/SKILL.md"),
      rootClass: "project",
      digest: "e".repeat(64),
      metadata: {
        name: "fixture",
        description: "Fixture",
        frontmatter: { name: "fixture" },
      },
      content: "Execute fixture",
    },
    profile: {
      profileId: "profile-evidence" as ProfileId,
      provider: "codex",
      model: "gpt-5",
      effort: "high",
      protocolVersion: 1,
      recipeId: "codex-acp",
      adapterVersion: "1.2.3",
      readinessCheckedAt: 90,
    },
    repository: {
      trusted: true,
      canonicalPath: binding.repositoryRoot,
      checkedAt: 90,
      message: "verified",
    },
    worktree: binding,
  };
}

async function createEvidenceLifecycleFixture(): Promise<EvidenceLifecycleFixture> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kitten-evidence-lifecycle-")));
  temporaryDirectories.push(root);
  runGit(root, ["init", "-b", "main"]);
  runGit(root, ["config", "user.name", "Kitten Test"]);
  runGit(root, ["config", "user.email", "kitten@example.invalid"]);
  writeFileSync(join(root, "tracked.txt"), "base\n");
  runGit(root, ["add", "tracked.txt"]);
  runGit(root, ["commit", "-m", "baseline"]);
  const baselineCommit = runGit(root, ["rev-parse", "HEAD"]);
  const remote = join(root, "delivery-remote.git");
  runGit(root, ["init", "--bare", remote]);
  runGit(root, ["remote", "add", "origin", remote]);
  const managedRoot = join(root, ".kitten", "worktrees", "cards");
  mkdirSync(managedRoot, { recursive: true });
  const worktree = join(managedRoot, EVIDENCE_BINDING_ID);
  runGit(root, [
    "worktree",
    "add",
    "-b",
    `kitten/card/${EVIDENCE_BINDING_ID}`,
    worktree,
    baselineCommit,
  ]);
  const binding: CardWorktreeBinding = {
    bindingVersion: 1,
    bindingId: EVIDENCE_BINDING_ID,
    boardId: EVIDENCE_BOARD_ID,
    cardId: EVIDENCE_CARD_ID,
    repositoryRoot: root,
    repositoryGitDir: realpathSync(join(root, ".git")),
    managedRoot: realpathSync(managedRoot),
    worktreePath: realpathSync(worktree),
    branch: `kitten/card/${EVIDENCE_BINDING_ID}`,
    baselineBranch: "main",
    baselineCommit,
    lifecycle: "active",
    reason: null,
    createdAt: 10,
    updatedAt: 10,
  };
  const filename = join(root, "lifecycle.sqlite");
  const database = openLifecycleDatabase(filename);
  migrateDatabase(database, { now: () => 1 });
  const journal = createEventJournal(database);
  const card: CardProjection = {
    cardId: EVIDENCE_CARD_ID,
    boardId: EVIDENCE_BOARD_ID,
    stageId: EVIDENCE_STAGE_ID,
    title: "Evidence lifecycle",
    description: "Fixture",
    provider: "codex",
    model: "gpt-5",
    effort: "high",
    skillOverrideId: EVIDENCE_SKILL_ID,
    runnable: true,
    executionStatus: "idle",
    version: 1,
    createdAt: 3,
    updatedAt: 3,
  };
  journal.append({
    eventId: "evidence-lifecycle-board",
    boardId: EVIDENCE_BOARD_ID,
    actor: "operator",
    kind: "board_upserted",
    occurredAt: 1,
    payload: {
      boardId: EVIDENCE_BOARD_ID,
      repositoryPath: root,
      workflowVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  });
  journal.append({
    eventId: "evidence-lifecycle-stage",
    boardId: EVIDENCE_BOARD_ID,
    actor: "operator",
    kind: "stage_upserted",
    occurredAt: 2,
    payload: {
      stageId: EVIDENCE_STAGE_ID,
      boardId: EVIDENCE_BOARD_ID,
      label: "Final",
      position: 0,
      defaultSkillId: null,
      configured: false,
      workflowVersion: 1,
      updatedAt: 2,
    },
  });
  journal.append({
    eventId: "evidence-lifecycle-card",
    boardId: EVIDENCE_BOARD_ID,
    cardId: EVIDENCE_CARD_ID,
    actor: "operator",
    kind: "card_upserted",
    occurredAt: 3,
    payload: card,
  });
  journal.append({
    eventId: "evidence-lifecycle-binding",
    boardId: EVIDENCE_BOARD_ID,
    cardId: EVIDENCE_CARD_ID,
    actor: "system",
    kind: "card_worktree_binding_recorded",
    occurredAt: 10,
    payload: binding,
  });
  const starting = {
    attemptId: EVIDENCE_ATTEMPT_ID,
    boardId: EVIDENCE_BOARD_ID,
    cardId: EVIDENCE_CARD_ID,
    generation: EVIDENCE_GENERATION,
    state: "starting" as const,
    sessionId: null,
    failure: null,
    createdAt: 100,
    startedAt: null,
    terminalAt: null,
  };
  journal.append({
    eventId: "evidence-lifecycle-attempt-created",
    boardId: EVIDENCE_BOARD_ID,
    cardId: EVIDENCE_CARD_ID,
    attemptId: EVIDENCE_ATTEMPT_ID,
    attemptSequence: 0,
    actor: "system",
    kind: "attempt_lifecycle_committed",
    occurredAt: 100,
    payload: {
      operation: "created",
      changes: [
        {
          entity: "card",
          operation: "upsert",
          value: {
            ...card,
            executionStatus: "running",
            version: 2,
            updatedAt: 100,
          },
        },
        { entity: "attempt", operation: "upsert", value: starting },
        {
          entity: "run_context",
          operation: "insert",
          value: evidenceRunContext(binding),
        },
      ],
    },
  });
  journal.append({
    eventId: "evidence-lifecycle-attempt-started",
    boardId: EVIDENCE_BOARD_ID,
    cardId: EVIDENCE_CARD_ID,
    attemptId: EVIDENCE_ATTEMPT_ID,
    attemptSequence: 1,
    actor: "system",
    kind: "attempt_lifecycle_committed",
    occurredAt: 101,
    payload: {
      operation: "started",
      changes: [{
        entity: "attempt",
        operation: "upsert",
        value: {
          ...starting,
          state: "running",
          sessionId: "session-evidence",
          startedAt: 101,
        },
      }],
    },
  });
  const terminal = await createActivityIngestor({ journal }).ingest({
    eventId: toOpaqueId<ActivityEventId>("evidence-lifecycle-success")!,
    attemptId: EVIDENCE_ATTEMPT_ID,
    generation: EVIDENCE_GENERATION,
    sequence: toActivitySequence(2)!,
    occurredAt: 102,
    activity: { kind: "attempt_state", state: "succeeded" },
  });
  if (terminal.status !== "committed") throw new Error("Could not seed succeeded attempt");
  return { database, filename, journal, binding, remote };
}

function seedReviewEvidence(journal: EventJournal, cardVersion: number): ReviewEvidenceRecord {
  const snapshot = journal.snapshot();
  const card = snapshot.cards[0]!;
  const attempt = snapshot.attempts.at(-1)!;
  const patchBlob = new TextEncoder().encode("recovery review patch\n");
  const evidenceId = `recovery-evidence-${cardVersion}`;
  const evidence: ReviewEvidenceRecord = {
    evidenceId,
    boardId: card.boardId,
    cardId: card.cardId,
    attemptId: attempt.attemptId as ReviewEvidenceRecord["attemptId"],
    generation: attempt.generation,
    worktreeBindingId: snapshot.cardWorktrees[0]!.bindingId,
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40),
    policyVersion: 1,
    evidenceDigest: createHash("sha256").update(evidenceId).digest("hex"),
    fileCount: 1,
    totalPatchBytes: patchBlob.byteLength,
    createdAt: 315,
    files: [{
      evidenceId,
      fileIndex: 0,
      fileId: "recovery-file",
      status: "modified",
      oldPath: "src/recovery.ts",
      newPath: "src/recovery.ts",
      oldMode: "100644",
      newMode: "100644",
      isBinary: false,
      additions: 1,
      deletions: 0,
      patchByteLength: patchBlob.byteLength,
      patchDigest: createHash("sha256").update(patchBlob).digest("hex"),
      contentDigest: null,
      patchBlob,
    }],
  };
  journal.immediate((transaction) => {
    transaction.persistReviewEvidence(evidence);
    transaction.append({
      eventId: `evidence:${evidence.evidenceId}`,
      boardId: card.boardId,
      cardId: card.cardId,
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
        changes: [{ entity: "card", operation: "upsert", value: card }],
      },
    }, {
      preconditions: [{ entity: "card", id: card.cardId, expectedVersion: card.version }],
    });
  });
  return evidence;
}

function catalogFrom(context: ReturnType<typeof createEventJournal>["snapshot"] extends () => infer Snapshot
  ? Snapshot extends { runContexts: readonly (infer RunContext)[] } ? RunContext : never
  : never): SkillCatalog {
  const skill = context.skill;
  const entry = {
    skillId: skill.skillId,
    canonicalPath: skill.canonicalPath,
    rootClass: skill.rootClass,
    rootPath: "/secret/path/.agents/skills",
    digest: skill.digest,
    metadata: skill.metadata,
    order: 0,
    hasNameCollision: false,
    diagnostics: [],
  } as const;
  return { roots: [], entries: [entry], diagnostics: [], resolvedSkills: new Map([[skill.skillId, { entry, validatedContent: skill.content }]]) };
}

function profileFrom(context: Parameters<typeof catalogFrom>[0]): CertifiedDirectAcpProfile {
  return {
    profileId: context.profile.profileId as ProfileId,
    provider: context.profile.provider,
    models: [context.profile.model],
    efforts: [context.profile.effort],
    readiness: { profileId: context.profile.profileId as ProfileId, ready: true, protocolVersion: context.profile.protocolVersion },
    certification: {
      recipeId: context.profile.recipeId,
      adapterVersion: context.profile.adapterVersion,
      checkedAt: context.profile.readinessCheckedAt,
    },
  };
}

class ReviewWindowFactory implements DesktopWindowFactory {
  review?: Parameters<DesktopWindowFactory["open"]>[0]["onReviewCard"];
  readonly messages: HostMessageEnvelope[] = [];

  open(options: Parameters<DesktopWindowFactory["open"]>[0]) {
    this.review = options.onReviewCard;
    return {
      sendHostMessage: (message: HostMessageEnvelope) => this.messages.push(message),
      removeHandlers: () => { this.review = undefined; },
      close() {},
    };
  }
}
