import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
import { createAttemptCoordinator } from "../src/attempts/attemptCoordinator.ts";
import type { CertifiedDirectAcpProfile } from "../src/attempts/contracts.ts";
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
import { startDesktopShell, type DesktopWindowFactory } from "../src/main.ts";
import { createCardNotificationService } from "../src/notifications/cardNotificationService.ts";
import { createEventJournal } from "../src/persistence/eventJournal.ts";
import { migrateDatabase } from "../src/persistence/migrations.ts";
import { rebuildProjections } from "../src/persistence/projectionRebuilder.ts";
import { closeSqliteDatabase, openSqliteDatabase } from "../src/persistence/sqliteDatabase.ts";
import type { HostMessageEnvelope } from "../src/shared/rpc.ts";
import { createWorkflowCommandHandler } from "../src/workflow/workflowCommands.ts";
import { workflowIds } from "../src/workflow/workflowTypes.ts";

const temporaryDirectories: string[] = [];
afterEach(() => {
  while (temporaryDirectories.length > 0) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
});

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
      turnState: "active",
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
      payload: { operation: "created", queue },
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
    const desktop = createDesktopCoordinator({ journal, now: () => 200 });
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
    expect(await coordinator.confirmQueuedFollowUp({
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      expectedQueueVersion: queue.version,
      queueId: "queue-before-restart" as FollowUpQueueId,
    })).toMatchObject({ status: "rejected", reason: { code: "attempt_terminal" } });
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

    const reviewService = createReviewDispositionService({ journal, now: () => 320 });
    const reviewRpc = createDesktopReviewRpc(reviewService);
    const windowFactory = new ReviewWindowFactory();
    startDesktopShell({ windowFactory, reviewRpc });
    const reviewResult = await windowFactory.review!({
      commandId: "rpc-review-command",
      input: {
        reviewId: "review-after-restart",
        boardId: ready.boardId,
        cardId: ready.cardId,
        expectedCardVersion: ready.version,
        disposition: "approved",
      },
    });
    expect(reviewResult.result).toMatchObject({ status: "committed" });
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
