import { afterEach, describe, expect, test } from "bun:test";
import type { AttemptId, ProfileId } from "@kitten/engine";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkillCatalog, SkillCatalogEntry } from "../src/catalog/contracts.ts";
import { createAttemptCoordinator } from "../src/attempts/attemptCoordinator.ts";
import type { CertifiedDirectAcpProfile } from "../src/attempts/contracts.ts";
import { createDirectAcpAttemptStarter, type DirectAcpConnectionFactory } from "../src/attempts/directAcpAttempt.ts";
import {
  createFollowUpQueue,
  enqueueFollowUp,
  followUpQueueFence,
  markFollowUpDispatching,
  retryInterruptedFollowUp,
  type FollowUpQueueId,
} from "../src/attempts/followUpQueue.ts";
import { createGlobalAttemptScheduler } from "../src/attempts/scheduler.ts";
import {
  ATTENTION_ATTEMPT_ID,
  ATTENTION_BOARD_ID,
  ATTENTION_CARD_ID,
  ATTENTION_GENERATION,
  seedAttentionAttempt,
} from "../src/attention/testSupport.ts";
import { createDesktopPromptSubmissionRpc } from "../src/host/desktopRpc.ts";
import { recoverInterruptedAttempts } from "../src/host/recovery.ts";
import { createEventJournal, type EventJournal } from "../src/persistence/eventJournal.ts";
import { migrateDatabase } from "../src/persistence/migrations.ts";
import { rebuildProjections } from "../src/persistence/projectionRebuilder.ts";
import { closeSqliteDatabase, openSqliteDatabase } from "../src/persistence/sqliteDatabase.ts";
import type { CardWorktreeBinding } from "../src/worktrees/contracts.ts";
import { workflowIds, type CardProjection } from "../src/workflow/workflowTypes.ts";

const directories: string[] = [];
afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

const BOARD_ID = workflowIds.board("board-follow-up-integration");
const STAGE_ID = workflowIds.stage("stage-follow-up-integration");
const CARD_ID = workflowIds.card("card-follow-up-integration");
const SKILL_ID = workflowIds.skill(`skill:${"d".repeat(64)}`);
const PROFILE_ID = "profile-follow-up-integration" as ProfileId;

describe("durable follow-up queue through typed host RPC and fake ACP", () => {
  test("persists before RPC success, deduplicates delivery, and dispatches only after the ACP boundary", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kitten-follow-up-"));
    directories.push(directory);
    const filename = join(directory, "desktop.sqlite");
    const database = openSqliteDatabase({ filename });
    migrateDatabase(database, { now: () => 1 });
    const journal = createEventJournal(database);
    seed(journal);

    const prompts: string[] = [];
    let cancellationCalls = 0;
    let releaseInitial: (() => void) | undefined;
    const initialBoundary = new Promise<void>((resolve) => { releaseInitial = resolve; });
    const factory: DirectAcpConnectionFactory = {
      async connect() {
        return {
          async newSession() { return { sessionId: "session-integrated-follow-up" }; },
          async prompt({ prompt }) {
            prompts.push(prompt);
            if (prompts.length === 1) await initialBoundary;
            return { stopReason: "end_turn" };
          },
          subscribeActivity() { return () => {}; },
          close() {},
          cancel() { cancellationCalls += 1; },
        };
      },
    };
    let event = 0;
    const coordinator = createAttemptCoordinator({
      journal,
      scheduler: createGlobalAttemptScheduler(),
      worktrees: {
        async ensure() { return { status: "reused", binding: worktree() }; },
        async cleanupExplicit() { return { status: "refused", reason: "live" }; },
      },
      directAcp: createDirectAcpAttemptStarter(factory),
      getCatalog: () => catalog(),
      resolveProfile: () => profile(),
      verifyRepository: () => ({
        trusted: true,
        canonicalPath: "/tmp/repository",
        checkedAt: 10,
        message: "Trusted repository identity verified",
      }),
      now: () => 100 + event,
      createAttemptId: () => "attempt-follow-up-integration",
      createEventId: (operation) => `attempt-${operation}-${++event}`,
      createFollowUpEventId: (operation) => `follow-up-${operation}-${++event}`,
    });
    const rpc = createDesktopPromptSubmissionRpc(coordinator);
    const started = await coordinator.start(CARD_ID, "Initial turn");
    if (started.status !== "started") throw new Error(`fixture attempt did not start: ${JSON.stringify(started)}`);
    for (let count = 0; count < 20 && prompts.length === 0; count += 1) await Promise.resolve();
    const input = {
      commandId: "queue-command",
      boardId: BOARD_ID,
      cardId: CARD_ID,
      expectedCardVersion: 2,
      content: "Run the verified follow-up",
      source: "composer" as const,
      activeAttempt: {
        attemptId: started.attempt.attemptId,
        generation: started.attempt.generation,
      },
    };
    const queued = await rpc.submitCardPrompt(input);
    const duplicate = await rpc.submitCardPrompt(input);
    expect(queued).toMatchObject({
      kind: "submit_card_prompt_result",
      commandId: "queue-command",
      result: { status: "ok", outcome: "queued" },
    });
    expect(duplicate).toEqual(queued);
    expect(journal.snapshot().followUpQueues[0]?.drafts).toMatchObject([
      { queueId: "queue-command", text: "Run the verified follow-up", state: "queued" },
    ]);
    expect(prompts).toEqual(["Initial turn"]);
    expect(cancellationCalls).toBe(0);
    releaseInitial?.();
    for (
      let count = 0;
      count < 80
      && journal.snapshot().followUpQueues[0]?.drafts[0]?.state !== "dispatched";
      count += 1
    ) await Promise.resolve();
    expect(prompts).toEqual(["Initial turn", "Run the verified follow-up"]);
    expect(journal.snapshot().followUpQueues[0]?.drafts[0]?.state).toBe("dispatched");
    expect(journal.events().filter(
      (candidate) => candidate.kind === "prompt_submission_committed",
    )).toHaveLength(1);

    const live = journal.snapshot();
    closeSqliteDatabase(database);
    const reopened = openSqliteDatabase({ filename });
    try {
      const reopenedJournal = createEventJournal(reopened);
      expect(reopenedJournal.snapshot()).toEqual(live);
      expect(rebuildProjections(reopened)).toEqual(live);
      let restartedPromptCalls = 0;
      const restarted = createAttemptCoordinator({
        journal: reopenedJournal,
        scheduler: createGlobalAttemptScheduler(),
        worktrees: {
          async ensure() { return { status: "reused", binding: worktree() }; },
          async cleanupExplicit() { return { status: "refused", reason: "live" }; },
        },
        directAcp: createDirectAcpAttemptStarter({
          async connect() {
            return {
              async newSession() { return { sessionId: "should-not-start" }; },
              async prompt() { restartedPromptCalls += 1; return { stopReason: "end_turn" }; },
              subscribeActivity() { return () => {}; },
              close() {},
            };
          },
        }),
        getCatalog: () => catalog(),
        resolveProfile: () => profile(),
        verifyRepository: () => ({
          trusted: true,
          canonicalPath: "/tmp/repository",
          checkedAt: 10,
          message: "Trusted repository identity verified",
        }),
      });
      expect(await restarted.submitCardPrompt(input)).toEqual(queued.result);
      expect(restartedPromptCalls).toBe(0);
    } finally {
      closeSqliteDatabase(reopened);
    }
  });

  test("reopens FIFO order, interrupts ambiguous delivery with zero sends, and retries only that head", () => {
    const directory = mkdtempSync(join(tmpdir(), "kitten-follow-up-recovery-"));
    directories.push(directory);
    const filename = join(directory, "desktop.sqlite");
    let database = openSqliteDatabase({ filename });
    migrateDatabase(database, { now: () => 1 });
    let journal = createEventJournal(database);
    seedAttentionAttempt(journal);

    let queue = createFollowUpQueue({
      boardId: ATTENTION_BOARD_ID,
      cardId: ATTENTION_CARD_ID,
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      queueId: "queue-restart-1" as FollowUpQueueId,
      text: "first persisted prompt",
      occurredAt: 110,
    });
    appendQueue(journal, "queue-restart-enqueued-1", "enqueued", queue, 0);
    queue = enqueueFollowUp(
      queue,
      {
        queueId: "queue-restart-2" as FollowUpQueueId,
        text: "second persisted prompt",
        occurredAt: 111,
      },
      followUpQueueFence(queue),
    );
    appendQueue(journal, "queue-restart-enqueued-2", "enqueued", queue, 1);
    queue = markFollowUpDispatching(
      queue,
      "queue-restart-1" as FollowUpQueueId,
      112,
      followUpQueueFence(queue),
    );
    appendQueue(journal, "queue-restart-dispatching", "dispatching", queue, 2);

    closeSqliteDatabase(database);
    database = openSqliteDatabase({ filename });
    journal = createEventJournal(database);
    expect(journal.snapshot().followUpQueues[0]!.drafts.map(({ queueId }) => String(queueId)))
      .toEqual(["queue-restart-1", "queue-restart-2"]);

    const dispatchedBeforeRecovery = journal.events()
      .filter((event) => (
        event.kind === "follow_up_queue_committed"
        && event.payload.operation === "dispatched"
      )).length;
    recoverInterruptedAttempts({
      journal,
      now: () => 200,
      createEventId: () => "queue-restart-recovery",
    });
    expect(journal.events()
      .filter((event) => (
        event.kind === "follow_up_queue_committed"
        && event.payload.operation === "dispatched"
      ))).toHaveLength(dispatchedBeforeRecovery);
    const interrupted = journal.snapshot().followUpQueues[0]!;
    expect(interrupted.drafts.map(({ state }) => state)).toEqual(["interrupted", "queued"]);
    const untouchedSecond = interrupted.drafts[1];

    const retried = retryInterruptedFollowUp(
      interrupted,
      "queue-restart-1" as FollowUpQueueId,
      210,
      followUpQueueFence(interrupted),
    );
    appendQueue(journal, "queue-restart-retried", "retried", retried, interrupted.version);
    expect(journal.snapshot().followUpQueues[0]!.drafts).toEqual([
      expect.objectContaining({ queueId: "queue-restart-1", state: "queued" }),
      untouchedSecond,
    ]);
    expect(rebuildProjections(database)).toEqual(journal.snapshot());
    expect(journal.snapshot().followUpQueues[0]!.drafts.every(({ state }) => state !== "dispatched"))
      .toBeTrue();
    closeSqliteDatabase(database);
  });

  test("normalizes legacy immutable queue events and rebuilds the same v2 order and version", () => {
    const directory = mkdtempSync(join(tmpdir(), "kitten-follow-up-legacy-"));
    directories.push(directory);
    const filename = join(directory, "desktop.sqlite");
    let database = openSqliteDatabase({ filename });
    migrateDatabase(database, { now: () => 1 });
    const journal = createEventJournal(database);
    seedAttentionAttempt(journal);

    const first = legacyDraft("legacy-queue-1", "first legacy prompt", "queued", 110);
    const second = legacyDraft("legacy-queue-2", "second legacy prompt", "queued", 112);
    const projections = [
      legacyQueue(1, "active", [first], 110),
      legacyQueue(2, "settled", [{ ...first, state: "awaiting_confirmation", updatedAt: 111 }], 111),
      legacyQueue(3, "settled", [
        { ...first, state: "awaiting_confirmation", updatedAt: 111 },
        second,
      ], 112),
      legacyQueue(4, "dispatching", [
        {
          ...first,
          state: "confirmed",
          updatedAt: 113,
          confirmedAt: 113,
        },
        second,
      ], 113),
    ];
    const operations = ["created", "head_ready", "created", "confirmed"] as const;
    const insert = database.query<void, [
      string,
      string,
      string,
      number,
      string,
    ]>(`
      INSERT INTO journal_events(
        event_id, board_id, card_id, actor, kind, occurred_at, payload_json
      ) VALUES (?, ?, ?, 'system', 'follow_up_queue_committed', ?, ?)
    `);
    projections.forEach((projection, index) => {
      insert.run(
        `legacy-queue-event-${index + 1}`,
        ATTENTION_BOARD_ID,
        ATTENTION_CARD_ID,
        projection.updatedAt,
        JSON.stringify({ operation: operations[index], queue: projection }),
      );
    });
    insert.finalize();
    const finalProjection = projections.at(-1)!;
    database.query(`
      INSERT INTO follow_up_queue_projections(
        attempt_id, board_id, card_id, generation, version, projection_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      ATTENTION_ATTEMPT_ID,
      ATTENTION_BOARD_ID,
      ATTENTION_CARD_ID,
      ATTENTION_GENERATION,
      finalProjection.version,
      JSON.stringify(finalProjection),
      finalProjection.updatedAt,
    );
    database.run(`
      UPDATE projection_metadata
      SET revision = revision + 4,
        last_journal_order = (SELECT MAX(journal_order) FROM journal_events)
      WHERE singleton = 1
    `);

    closeSqliteDatabase(database);
    database = openSqliteDatabase({ filename });
    const reopened = createEventJournal(database);
    const live = reopened.snapshot();
    expect(live.followUpQueues[0]).toMatchObject({
      schemaVersion: 2,
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      version: 4,
      drafts: [
        { queueId: "legacy-queue-1", state: "interrupted" },
        { queueId: "legacy-queue-2", state: "queued" },
      ],
    });
    expect(reopened.events()
      .filter((event) => event.kind === "follow_up_queue_committed")
      .map((event) => event.payload.operation))
      .toEqual(["enqueued", "enqueued", "enqueued", "interrupted"]);
    expect(rebuildProjections(database)).toEqual(live);
    closeSqliteDatabase(database);
  });
});

function appendQueue(
  journal: EventJournal,
  eventId: string,
  operation: "enqueued" | "dispatching" | "retried",
  queue: ReturnType<typeof createFollowUpQueue>,
  expectedVersion: number,
): void {
  journal.append({
    eventId,
    boardId: queue.boardId,
    cardId: queue.cardId,
    actor: operation === "dispatching" ? "system" : "operator",
    kind: "follow_up_queue_committed",
    occurredAt: queue.updatedAt,
    payload: { operation, queue },
  }, {
    preconditions: [{
      entity: "follow_up_queue",
      id: queue.attemptId,
      expectedVersion,
    }],
  });
}

function legacyDraft(
  queueId: string,
  text: string,
  state: "queued" | "awaiting_confirmation" | "confirmed",
  occurredAt: number,
) {
  return {
    queueId,
    text,
    state,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    confirmedAt: null as number | null,
    dispatchedAt: null,
    removedAt: null,
  };
}

function legacyQueue(
  version: number,
  turnState: "active" | "settled" | "dispatching",
  drafts: readonly ReturnType<typeof legacyDraft>[],
  updatedAt: number,
) {
  return {
    schemaVersion: 1,
    boardId: ATTENTION_BOARD_ID,
    cardId: ATTENTION_CARD_ID,
    attemptId: ATTENTION_ATTEMPT_ID,
    generation: ATTENTION_GENERATION,
    version,
    turnState,
    drafts,
    updatedAt,
  };
}

function seed(journal: EventJournal): void {
  journal.append({
    eventId: "seed-board",
    boardId: BOARD_ID,
    actor: "operator",
    kind: "board_upserted",
    occurredAt: 1,
    payload: { boardId: BOARD_ID, repositoryPath: "/tmp/repository", workflowVersion: 1, createdAt: 1, updatedAt: 1 },
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
  journal.append({
    eventId: "seed-card",
    boardId: BOARD_ID,
    cardId: CARD_ID,
    actor: "operator",
    kind: "card_upserted",
    occurredAt: 3,
    payload: card(),
  });
}

function card(): CardProjection {
  return {
    cardId: CARD_ID,
    boardId: BOARD_ID,
    stageId: STAGE_ID,
    title: "Follow-up integration",
    description: "Prove the queue boundary",
    provider: "codex",
    model: "gpt-5",
    effort: "high",
    skillOverrideId: null,
    runnable: true,
    executionStatus: "idle",
    version: 1,
    createdAt: 3,
    updatedAt: 3,
  };
}

function catalog(): SkillCatalog {
  const entry: SkillCatalogEntry = {
    skillId: SKILL_ID,
    canonicalPath: "/tmp/skills/follow-up/SKILL.md",
    rootClass: "project",
    rootPath: "/tmp/skills",
    digest: "d".repeat(64),
    metadata: { name: "follow-up", description: "Fixture", frontmatter: { name: "follow-up" } },
    order: 0,
    hasNameCollision: false,
    diagnostics: [],
  };
  return {
    roots: [],
    entries: [entry],
    diagnostics: [],
    resolvedSkills: new Map([[SKILL_ID, { entry, validatedContent: "Execute fixture" }]]),
  };
}

function profile(): CertifiedDirectAcpProfile {
  return {
    profileId: PROFILE_ID,
    provider: "codex",
    models: ["gpt-5"],
    efforts: ["high"],
    readiness: { profileId: PROFILE_ID, ready: true, protocolVersion: 1 },
    certification: { recipeId: "codex-acp", adapterVersion: "1.2.3", checkedAt: 10 },
  };
}

function worktree(): CardWorktreeBinding {
  return {
    bindingVersion: 1,
    bindingId: "kw-followupint01",
    boardId: BOARD_ID,
    cardId: CARD_ID,
    repositoryRoot: "/tmp/repository",
    repositoryGitDir: "/tmp/repository/.git",
    managedRoot: "/tmp/repository/.kitten/worktrees/cards",
    worktreePath: "/tmp/repository/.kitten/worktrees/cards/kw-followupint01",
    branch: "kitten/card/kw-followupint01",
    baselineBranch: "main",
    baselineCommit: "e".repeat(40),
    lifecycle: "active",
    reason: null,
    createdAt: 10,
    updatedAt: 10,
  };
}
