import { afterEach, describe, expect, test } from "bun:test";
import type { AttemptId, ProfileId } from "@kitten/engine";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkillCatalog, SkillCatalogEntry } from "../src/catalog/contracts.ts";
import { createAttemptCoordinator } from "../src/attempts/attemptCoordinator.ts";
import type { CertifiedDirectAcpProfile } from "../src/attempts/contracts.ts";
import { createDirectAcpAttemptStarter, type DirectAcpConnectionFactory } from "../src/attempts/directAcpAttempt.ts";
import type { FollowUpQueueId } from "../src/attempts/followUpQueue.ts";
import { createGlobalAttemptScheduler } from "../src/attempts/scheduler.ts";
import { createDesktopFollowUpRpc } from "../src/host/desktopRpc.ts";
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
  test("persists lifecycle evidence and dispatches one confirmed prompt without cancellation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kitten-follow-up-"));
    directories.push(directory);
    const filename = join(directory, "desktop.sqlite");
    const database = openSqliteDatabase({ filename });
    migrateDatabase(database, { now: () => 1 });
    const journal = createEventJournal(database);
    seed(journal);

    const prompts: string[] = [];
    let cancellationCalls = 0;
    let blockerActive = false;
    const factory: DirectAcpConnectionFactory = {
      async connect() {
        return {
          async newSession() { return { sessionId: "session-integrated-follow-up" }; },
          async prompt({ prompt }) { prompts.push(prompt); return { stopReason: "end_turn" }; },
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
      hasActiveAttention: () => blockerActive,
      now: () => 100 + event,
      createAttemptId: () => "attempt-follow-up-integration",
      createEventId: (operation) => `attempt-${operation}-${++event}`,
      createFollowUpEventId: (operation) => `follow-up-${operation}-${++event}`,
    });
    const rpc = createDesktopFollowUpRpc(coordinator);
    const started = await coordinator.start(CARD_ID);
    if (started.status !== "started") throw new Error(`fixture attempt did not start: ${JSON.stringify(started)}`);
    const fence = { attemptId: started.attempt.attemptId, generation: started.attempt.generation };

    const queued = await rpc.queueFollowUp({
      commandId: "queue-command",
      input: {
        ...fence,
        expectedQueueVersion: 0,
        queueId: "queue-integrated" as FollowUpQueueId,
        text: "Run the verified follow-up",
      },
    });
    expect(queued).toMatchObject({
      kind: "follow_up_command_result",
      commandId: "queue-command",
      result: { status: "ok", projection: { version: 1, turnState: "active" } },
    });
    expect(prompts).toEqual([]);
    expect(cancellationCalls).toBe(0);
    expect(coordinator.settleTurn(fence)).toMatchObject({ status: "ok", projection: { version: 2 } });

    const stale = await rpc.confirmQueuedFollowUp({
      commandId: "stale-command",
      input: {
        ...fence,
        expectedQueueVersion: 1,
        queueId: "queue-integrated" as FollowUpQueueId,
      },
    });
    expect(stale).toMatchObject({
      result: { status: "conflict", conflict: { kind: "follow_up_queue", code: "stale_version" } },
    });
    blockerActive = true;
    const blockedSnapshot = journal.snapshot().followUpQueues;
    expect(await rpc.confirmQueuedFollowUp({
      commandId: "blocked-command",
      input: {
        ...fence,
        expectedQueueVersion: 2,
        queueId: "queue-integrated" as FollowUpQueueId,
      },
    })).toMatchObject({ result: { status: "rejected", reason: { code: "blocker_active" } } });
    expect(journal.snapshot().followUpQueues).toEqual(blockedSnapshot);

    blockerActive = false;
    const confirmed = await rpc.confirmQueuedFollowUp({
      commandId: "confirm-command",
      input: {
        ...fence,
        expectedQueueVersion: 2,
        queueId: "queue-integrated" as FollowUpQueueId,
      },
    });
    expect(confirmed).toMatchObject({
      result: { status: "ok", projection: { version: 4, drafts: [{ state: "dispatched" }] } },
    });
    expect(prompts).toEqual(["Run the verified follow-up"]);
    expect(cancellationCalls).toBe(0);
    expect(await rpc.queueFollowUp({
      commandId: "queue-removable-command",
      input: {
        ...fence,
        expectedQueueVersion: 4,
        queueId: "queue-removable" as FollowUpQueueId,
        text: "remove before dispatch",
      },
    })).toMatchObject({ result: { status: "ok", projection: { version: 5 } } });
    expect(await rpc.removeQueuedFollowUp({
      commandId: "remove-command",
      input: {
        ...fence,
        expectedQueueVersion: 5,
        queueId: "queue-removable" as FollowUpQueueId,
      },
    })).toMatchObject({ result: { status: "ok", projection: { version: 6 } } });
    const operations = journal.events()
      .filter((candidate) => candidate.kind === "follow_up_queue_committed")
      .map((candidate) => candidate.payload.operation);
    expect(operations).toEqual(["created", "head_ready", "confirmed", "dispatched", "created", "removed"]);

    const live = journal.snapshot();
    closeSqliteDatabase(database);
    const reopened = openSqliteDatabase({ filename });
    try {
      const reopenedJournal = createEventJournal(reopened);
      expect(reopenedJournal.snapshot()).toEqual(live);
      expect(rebuildProjections(reopened)).toEqual(live);
    } finally {
      closeSqliteDatabase(reopened);
    }
  });
});

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
