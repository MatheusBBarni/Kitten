import { describe, expect, test } from "bun:test";
import { toActivitySequence, toOpaqueId, type ActivityEventId, type ProfileId } from "@kitten/engine";
import { createActivityIngestor } from "../src/attempts/activityIngestor.ts";
import { createAttemptCoordinator } from "../src/attempts/attemptCoordinator.ts";
import type { CertifiedDirectAcpProfile } from "../src/attempts/contracts.ts";
import { createDirectAcpAttemptStarter, type DirectAcpConnectionFactory } from "../src/attempts/directAcpAttempt.ts";
import type { FollowUpQueueId } from "../src/attempts/followUpQueue.ts";
import { createGlobalAttemptScheduler } from "../src/attempts/scheduler.ts";
import { createAttemptAskUserBridge } from "../src/attention/attemptAskUserBridge.ts";
import { createAttentionCoordinator } from "../src/attention/attentionCoordinator.ts";
import type { AttentionForm } from "../src/attention/contracts.ts";
import type { SkillCatalog } from "../src/catalog/contracts.ts";
import { createReviewDispositionService } from "../src/host/reviewDisposition.ts";
import { createCardNotificationService } from "../src/notifications/cardNotificationService.ts";
import { createEventJournal } from "../src/persistence/eventJournal.ts";
import { migrateDatabase } from "../src/persistence/migrations.ts";
import { closeSqliteDatabase, openSqliteDatabase } from "../src/persistence/sqliteDatabase.ts";
import type { CardWorktreeBinding } from "../src/worktrees/contracts.ts";
import { createWorkflowCommandHandler } from "../src/workflow/workflowCommands.ts";
import { workflowIds, type WorkflowCommand } from "../src/workflow/workflowTypes.ts";

describe("desktop governed lifecycle smoke", () => {
  test("runs blank board through Skill, blocker, confirmed follow-up, review, and zero publication", async () => {
    const database = openSqliteDatabase({ filename: ":memory:" });
    try {
      migrateDatabase(database, { now: () => 1 });
      const journal = createEventJournal(database);
      const commands = createWorkflowCommandHandler(journal, { now: (() => { let value = 10; return () => ++value; })() });
      const boardId = workflowIds.board("board-smoke");
      const stageId = workflowIds.stage("stage-smoke");
      const cardId = workflowIds.card("card-smoke");
      const skillId = workflowIds.skill(`skill:${"c".repeat(64)}`);
      execute(commands, { kind: "bind_repository", mutationId: workflowIds.mutation("smoke-bind"), boardId, repositoryPath: "/trusted/smoke" });
      execute(commands, {
        kind: "create_stage",
        mutationId: workflowIds.mutation("smoke-stage"),
        boardId,
        expectedWorkflowVersion: journal.snapshot().boards[0]!.workflowVersion,
        stageId,
        label: "Review",
      });
      execute(commands, {
        kind: "assign_stage_skill",
        mutationId: workflowIds.mutation("smoke-skill"),
        boardId,
        expectedWorkflowVersion: journal.snapshot().boards[0]!.workflowVersion,
        stageId,
        defaultSkillId: skillId,
      });
      execute(commands, {
        kind: "create_card",
        mutationId: workflowIds.mutation("smoke-card"),
        boardId,
        expectedWorkflowVersion: journal.snapshot().boards[0]!.workflowVersion,
        cardId,
        stageId,
        title: "Smoke card",
        description: "Verify the complete governed lifecycle",
        provider: "codex",
        model: "gpt-5",
        effort: "high",
        skillOverrideId: null,
        runnable: true,
      });

      const attention = createAttentionCoordinator({
        journal,
        notifications: createCardNotificationService({ deliver() {}, now: () => 101 }),
        now: () => 100,
        createBlockerId: () => "blocker-smoke",
        createEventId: (operation) => `smoke-attention-${operation}`,
      });
      const bridge = createAttemptAskUserBridge({ journal, attention, createCapability: () => "b".repeat(48) });
      let askCapability = "";
      let emitActivity: (input: unknown) => Promise<void> = async () => { throw new Error("not subscribed"); };
      const prompts: string[] = [];
      const directFactory: DirectAcpConnectionFactory = {
        async connect() {
          return {
            async newSession(input) {
              askCapability = input.askUserRoute?.capability ?? "";
              expect(input.skillContent).toContain("Smoke Skill");
              return { sessionId: "session-smoke-fresh" };
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
      let cleanupCalls = 0;
      let publicationCalls = 0;
      const binding = smokeBinding(boardId, cardId);
      const coordinator = createAttemptCoordinator({
        journal,
        scheduler: createGlobalAttemptScheduler(),
        worktrees: {
          async ensure() { return { status: "reused", binding }; },
          async cleanupExplicit() { cleanupCalls += 1; return { status: "refused", reason: "live" }; },
        },
        directAcp: createDirectAcpAttemptStarter(directFactory),
        activityIngestor: createActivityIngestor({ journal }),
        askUserBridge: bridge,
        hasActiveAttention: (attemptId) => attention.hasActive(attemptId),
        getCatalog: () => smokeCatalog(skillId),
        resolveProfile: () => smokeProfile(),
        verifyRepository: () => ({ trusted: true, canonicalPath: "/trusted/smoke", checkedAt: 90, message: "verified" }),
        now: (() => { let value = 110; return () => ++value; })(),
        createAttemptId: () => "attempt-smoke",
        createEventId: (operation) => `smoke-attempt-${operation}`,
        createFollowUpEventId: (operation) => `smoke-queue-${operation}`,
      });
      const started = await coordinator.start(cardId);
      if (started.status === "failed") throw new Error(`smoke attempt startup failed: ${started.failure.code} ${started.failure.message}`);
      expect(started.status).toBe("started");
      if (started.status !== "started") throw new Error("smoke attempt did not start");
      const fence = { attemptId: started.attempt.attemptId, generation: started.attempt.generation };
      expect(coordinator.queueFollowUp({
        ...fence,
        expectedQueueVersion: 0,
        queueId: "queue-smoke" as FollowUpQueueId,
        text: "Run the explicit verification follow-up",
      })).toMatchObject({ status: "ok", projection: { version: 1 } });

      const form: AttentionForm = {
        title: "Confirm verification",
        context: "The fixture requires an operator decision.",
        prompt: "Proceed with verification?",
        fields: [{
          id: "choice",
          label: "Decision",
          required: true,
          mode: "single",
          options: [{ id: "yes", label: "Proceed" }],
          allowsCustom: false,
        }],
      };
      const pendingAnswer = bridge.forward({ capability: askCapability, callId: "call-smoke", form });
      const blocker = await waitForBlocker(journal);
      expect(journal.snapshot().cards[0]!.executionStatus).toBe("needs_attention");
      attention.resolve({
        ...fence,
        blockerId: blocker.blockerId,
        expectedVersion: blocker.version,
        outcome: { kind: "submitted", answers: { choice: { selectedOptionIds: ["yes"] } } },
      });
      expect(await pendingAnswer).toMatchObject({ kind: "submitted" });
      expect(coordinator.settleTurn(fence)).toMatchObject({ status: "ok", projection: { version: 2 } });
      expect(await coordinator.confirmQueuedFollowUp({
        ...fence,
        expectedQueueVersion: 2,
        queueId: "queue-smoke" as FollowUpQueueId,
      })).toMatchObject({ status: "ok", projection: { version: 4 } });
      expect(prompts).toEqual(["Run the explicit verification follow-up"]);

      await emitActivity({
        eventId: toOpaqueId<ActivityEventId>("smoke-success")!,
        attemptId: started.attempt.attemptId,
        generation: started.attempt.generation,
        sequence: toActivitySequence(2)!,
        occurredAt: 130,
        activity: { kind: "attempt_state", state: "succeeded" },
      });
      const running = journal.snapshot().cards[0]!;
      const board = journal.snapshot().boards[0]!;
      execute(commands, {
        kind: "record_agent_success",
        mutationId: workflowIds.mutation("smoke-success-transition"),
        boardId,
        cardId,
        expectedWorkflowVersion: board.workflowVersion,
        expectedCardVersion: running.version,
      });
      const ready = journal.snapshot().cards[0]!;
      expect(ready.executionStatus).toBe("ready_for_review");
      expect(createReviewDispositionService({ journal, now: () => 140 }).reviewCard({
        reviewId: "smoke-review",
        boardId,
        cardId,
        expectedCardVersion: ready.version,
        disposition: "approved",
      })).toMatchObject({ status: "committed" });
      expect(journal.snapshot().cards[0]!.executionStatus).toBe("completed");
      expect(journal.snapshot().reviewDispositions).toHaveLength(1);
      expect(cleanupCalls).toBe(0);
      expect(publicationCalls).toBe(0);
      bridge.dispose();
    } finally {
      closeSqliteDatabase(database);
    }
  });
});

function execute(handler: ReturnType<typeof createWorkflowCommandHandler>, command: WorkflowCommand): void {
  const result = handler.execute(command);
  if (result.status !== "committed") throw new Error(`Smoke workflow command ${command.kind} failed: ${result.status}`);
}

async function waitForBlocker(journal: ReturnType<typeof createEventJournal>) {
  for (let count = 0; count < 20; count += 1) {
    const blocker = journal.snapshot().attentionBlockers[0];
    if (blocker !== undefined && blocker.notification.state !== "pending") return blocker;
    await Promise.resolve();
  }
  throw new Error("Smoke Attention Blocker was not committed");
}

function smokeCatalog(skillId: ReturnType<typeof workflowIds.skill>): SkillCatalog {
  const entry = {
    skillId,
    canonicalPath: "/trusted/smoke/.agents/skills/smoke/SKILL.md",
    rootClass: "project" as const,
    rootPath: "/trusted/smoke/.agents/skills",
    digest: "c".repeat(64),
    metadata: { name: "smoke", description: "Smoke", frontmatter: { name: "smoke" } },
    order: 0,
    hasNameCollision: false,
    diagnostics: [],
  };
  return { roots: [], entries: [entry], diagnostics: [], resolvedSkills: new Map([[skillId, { entry, validatedContent: "# Smoke Skill\nExecute safely." }]]) };
}

function smokeProfile(): CertifiedDirectAcpProfile {
  const profileId = "profile-smoke" as ProfileId;
  return {
    profileId,
    provider: "codex",
    models: ["gpt-5"],
    efforts: ["high"],
    readiness: { profileId, ready: true, protocolVersion: 1 },
    certification: { recipeId: "codex-acp", adapterVersion: "1.2.3", checkedAt: 90 },
  };
}

function smokeBinding(
  boardId: ReturnType<typeof workflowIds.board>,
  cardId: ReturnType<typeof workflowIds.card>,
): CardWorktreeBinding {
  return {
    bindingVersion: 1,
    bindingId: "kw-smoke0000001",
    boardId,
    cardId,
    repositoryRoot: "/trusted/smoke",
    repositoryGitDir: "/trusted/smoke/.git",
    managedRoot: "/trusted/smoke/.kitten/worktrees/cards",
    worktreePath: "/trusted/smoke/.kitten/worktrees/cards/kw-smoke0000001",
    branch: "kitten/card/kw-smoke0000001",
    baselineBranch: "main",
    baselineCommit: "d".repeat(40),
    lifecycle: "active",
    reason: null,
    createdAt: 90,
    updatedAt: 90,
  };
}
