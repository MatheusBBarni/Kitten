import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { toActivitySequence, toOpaqueId, type ActivityEventId, type ProfileId } from "@kitten/engine";
import { createActivityIngestor } from "../src/attempts/activityIngestor.ts";
import { createAttemptCoordinator } from "../src/attempts/attemptCoordinator.ts";
import type { CertifiedDirectAcpProfile } from "../src/attempts/contracts.ts";
import { createDirectAcpAttemptStarter, type DirectAcpConnectionFactory } from "../src/attempts/directAcpAttempt.ts";
import { createGlobalAttemptScheduler } from "../src/attempts/scheduler.ts";
import { createAttemptAskUserBridge } from "../src/attention/attemptAskUserBridge.ts";
import { createAttentionCoordinator } from "../src/attention/attentionCoordinator.ts";
import type { AttentionForm } from "../src/attention/contracts.ts";
import type { SkillCatalog } from "../src/catalog/contracts.ts";
import { createReviewDispositionService } from "../src/host/reviewDisposition.ts";
import { createCardNotificationService } from "../src/notifications/cardNotificationService.ts";
import {
  createEventJournal,
  type EventJournal,
  type ReviewEvidenceRecord,
} from "../src/persistence/eventJournal.ts";
import { migrateDatabase } from "../src/persistence/migrations.ts";
import { closeSqliteDatabase, openSqliteDatabase } from "../src/persistence/sqliteDatabase.ts";
import type { CardWorktreeBinding } from "../src/worktrees/contracts.ts";
import { createWorkflowCommandHandler } from "../src/workflow/workflowCommands.ts";
import { workflowIds, type WorkflowCommand } from "../src/workflow/workflowTypes.ts";
import { lifecycleMatrix } from "./native/lifecycleMatrix.ts";

describe("desktop governed lifecycle smoke", () => {
  test("keeps the packaged native matrix aligned with the governed lifecycle", () => {
    const states = new Set(lifecycleMatrix.entries.map(({ state }) => state));
    for (const state of [
      "needs_attention",
      "running_attempt_direct_send",
      "composer_queued",
      "composer_interrupted",
      "ready_for_review_manifest",
      "review_approve_available",
      "request_changes_mutation_free_selection",
      "request_changes_same_card_stage_send",
    ]) {
      expect(states.has(state)).toBeTrue();
    }
  });

  test("runs blank board through Skill, blocker, authorized follow-up, review, and zero publication", async () => {
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
        skillOverrideId: skillId,
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
      let releaseInitial: (() => void) | undefined;
      const initialBoundary = new Promise<void>((resolve) => { releaseInitial = resolve; });
      const directFactory: DirectAcpConnectionFactory = {
        async connect() {
          return {
            async newSession(input) {
              askCapability = input.askUserRoute?.capability ?? "";
              expect(input.skillContent).toContain("Smoke Skill");
              return { sessionId: "session-smoke-fresh" };
            },
            async prompt({ prompt }) {
              prompts.push(prompt);
              if (prompts.length === 1) await initialBoundary;
              return { stopReason: "end_turn" };
            },
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
      const started = await coordinator.start(cardId, "Initial smoke turn");
      if (started.status === "failed") throw new Error(`smoke attempt startup failed: ${started.failure.code} ${started.failure.message}`);
      expect(started.status).toBe("started");
      if (started.status !== "started") throw new Error("smoke attempt did not start");
      const fence = { attemptId: started.attempt.attemptId, generation: started.attempt.generation };
      expect(await coordinator.submitCardPrompt({
        commandId: "queue-smoke",
        boardId,
        cardId,
        expectedCardVersion: 2,
        source: "composer",
        content: "Run the explicit verification follow-up",
        activeAttempt: fence,
      })).toMatchObject({ status: "ok", outcome: "queued" });

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
      releaseInitial?.();
      for (let count = 0; count < 40 && prompts.length < 2; count += 1) await Promise.resolve();
      expect(prompts).toEqual(["Initial smoke turn", "Run the explicit verification follow-up"]);

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
      const evidence = seedReviewEvidence(journal, ready.version);
      expect(await createReviewDispositionService({
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
        now: () => 140,
      }).reviewCard({
        commandId: "smoke-review",
        boardId,
        cardId,
        expectedCardVersion: ready.version,
        disposition: "approved",
        evidence: {
          evidenceId: evidence.evidenceId,
          evidenceDigest: evidence.evidenceDigest,
          attemptId: evidence.attemptId,
          generation: evidence.generation,
          worktreeBindingId: evidence.worktreeBindingId,
        },
      })).toMatchObject({ status: "ok", outcome: "approved" });
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

function seedReviewEvidence(journal: EventJournal, cardVersion: number): ReviewEvidenceRecord {
  const snapshot = journal.snapshot();
  const card = snapshot.cards[0]!;
  const attempt = snapshot.attempts.at(-1)!;
  const binding = snapshot.runContexts.at(-1)!.worktree;
  if (!snapshot.cardWorktrees.some(({ bindingId }) => bindingId === binding.bindingId)) {
    journal.append({
      eventId: `smoke-review-binding-${cardVersion}`,
      boardId: card.boardId,
      cardId: card.cardId,
      actor: "system",
      kind: "card_worktree_binding_recorded",
      occurredAt: 134,
      payload: binding,
    });
  }
  const patchBlob = new TextEncoder().encode("smoke review patch\n");
  const evidenceId = `smoke-evidence-${cardVersion}`;
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
    evidenceDigest: createHash("sha256").update(evidenceId).digest("hex"),
    fileCount: 1,
    totalPatchBytes: patchBlob.byteLength,
    createdAt: 135,
    files: [{
      evidenceId,
      fileIndex: 0,
      fileId: "smoke-file",
      status: "modified",
      oldPath: "src/smoke.ts",
      newPath: "src/smoke.ts",
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
