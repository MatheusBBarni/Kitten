import { afterEach, describe, expect, test } from "bun:test";
import type { AttemptId, ProfileId } from "@kitten/engine";
import type { SkillCatalog, SkillCatalogEntry } from "../catalog/contracts.ts";
import { createEventJournal, type EventJournal, type JournalEvent } from "../persistence/eventJournal.ts";
import { migrateDatabase } from "../persistence/migrations.ts";
import { rebuildProjections } from "../persistence/projectionRebuilder.ts";
import { closeSqliteDatabase, openSqliteDatabase } from "../persistence/sqliteDatabase.ts";
import type { CardWorktreeBinding } from "../worktrees/contracts.ts";
import { workflowIds, type BoardId, type CardId, type CardProjection, type SkillId } from "../workflow/workflowTypes.ts";
import { createAttemptCoordinator, type ContentFreeFollowUpTelemetry } from "./attemptCoordinator.ts";
import type { CertifiedDirectAcpProfile } from "./contracts.ts";
import { createDirectAcpAttemptStarter, type DirectAcpConnectionFactory } from "./directAcpAttempt.ts";
import { createGlobalAttemptScheduler } from "./scheduler.ts";
import type { FollowUpQueueId } from "./followUpQueue.ts";

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
});

describe("confirmable non-cancelling follow-ups", () => {
  test("queues without cancellation or auto-send, then confirms exactly one FIFO head", async () => {
    const fixture = createFixture([CARD_ONE]);
    const prompts: string[] = [];
    const telemetry: unknown[] = [];
    let cancellationCalls = 0;
    const coordinator = fixture.coordinator({
      async connect() {
        return {
          async newSession() { return { sessionId: "session-follow-up" }; },
          async prompt({ prompt }) { prompts.push(prompt); return { stopReason: "end_turn" }; },
          subscribeActivity() { return () => {}; },
          close() {},
          cancel() { cancellationCalls += 1; },
        };
      },
    }, createGlobalAttemptScheduler(), fixture.journal, {
      telemetry: { record: (name, attributes) => telemetry.push({ name, attributes }) },
    });
    const started = await coordinator.start(CARD_ONE);
    if (started.status !== "started") throw new Error("expected started attempt");
    const fence = { attemptId: started.attempt.attemptId, generation: started.attempt.generation };

    expect(coordinator.queueFollowUp({ ...fence, expectedQueueVersion: 0, queueId: "queue-1" as FollowUpQueueId, text: "first" }).status).toBe("ok");
    expect(coordinator.queueFollowUp({ ...fence, expectedQueueVersion: 1, queueId: "queue-2" as FollowUpQueueId, text: "second" }).status).toBe("ok");
    expect(prompts).toEqual([]);
    expect(cancellationCalls).toBe(0);

    const settled = coordinator.settleTurn(fence);
    expect(settled).toMatchObject({ status: "ok", projection: { version: 3, turnState: "settled" } });
    if (settled.status !== "ok" || settled.projection === null) throw new Error("expected settled queue");
    expect(settled.projection.drafts.map(({ state }) => state)).toEqual(["awaiting_confirmation", "queued"]);

    const confirmed = await coordinator.confirmQueuedFollowUp({
      ...fence,
      expectedQueueVersion: 3,
      queueId: "queue-1" as FollowUpQueueId,
    });
    expect(confirmed).toMatchObject({ status: "ok", projection: { version: 5, turnState: "settled" } });
    expect(prompts).toEqual(["first"]);
    expect(JSON.stringify(telemetry)).not.toContain("first");
    expect(JSON.stringify(telemetry)).not.toContain("second");
    expect(cancellationCalls).toBe(0);
    expect(fixture.journal.events()
      .filter((event) => event.kind === "follow_up_queue_committed")
      .map((event) => event.payload.operation)).toEqual([
        "created", "created", "head_ready", "confirmed", "dispatched",
      ]);
    expect(await coordinator.confirmQueuedFollowUp({
      ...fence,
      expectedQueueVersion: 5,
      queueId: "queue-1" as FollowUpQueueId,
    })).toMatchObject({ status: "rejected", reason: { code: "stale_head" } });
    expect(prompts).toEqual(["first"]);

    const live = fixture.journal.snapshot();
    expect(rebuildProjections(fixture.database)).toEqual(live);
  });

  test("types stale, active-turn, blocker, failed, cancelled, and succeeded confirmation rejections", async () => {
    for (const terminalState of ["failed", "cancelled", "succeeded"] as const) {
      const fixture = createFixture([CARD_ONE]);
      let blockerActive = false;
      let promptCalls = 0;
      const coordinator = fixture.coordinator({
        async connect() {
          return {
            async newSession() { return { sessionId: `session-${terminalState}` }; },
            async prompt() { promptCalls += 1; return { stopReason: "end_turn" }; },
            subscribeActivity() { return () => {}; },
            close() {},
          };
        },
      }, createGlobalAttemptScheduler(), fixture.journal, { hasActiveAttention: () => blockerActive });
      const started = await coordinator.start(CARD_ONE);
      if (started.status !== "started") throw new Error("expected started attempt");
      const fence = { attemptId: started.attempt.attemptId, generation: started.attempt.generation };
      const queued = coordinator.queueFollowUp({
        ...fence,
        expectedQueueVersion: 0,
        queueId: "queue-terminal" as FollowUpQueueId,
        text: "keep me",
      });
      expect(queued.status).toBe("ok");
      await expect(coordinator.confirmQueuedFollowUp({
        ...fence,
        expectedQueueVersion: 1,
        queueId: "queue-terminal" as FollowUpQueueId,
      })).resolves.toMatchObject({ status: "rejected", reason: { code: "stale_head" } });
      const settled = coordinator.settleTurn(fence);
      expect(settled.status).toBe("ok");
      const beforeBlocker = fixture.journal.snapshot().followUpQueues;
      blockerActive = true;
      expect(await coordinator.confirmQueuedFollowUp({
        ...fence,
        expectedQueueVersion: 2,
        queueId: "queue-terminal" as FollowUpQueueId,
      })).toMatchObject({ status: "rejected", reason: { code: "blocker_active" } });
      expect(fixture.journal.snapshot().followUpQueues).toEqual(beforeBlocker);
      blockerActive = false;
      expect(await coordinator.confirmQueuedFollowUp({
        attemptId: fence.attemptId,
        generation: (Number(fence.generation) + 1) as typeof fence.generation,
        expectedQueueVersion: 2,
        queueId: "queue-terminal" as FollowUpQueueId,
      })).toMatchObject({ status: "rejected", reason: { code: "stale_generation" } });
      expect(await coordinator.confirmQueuedFollowUp({
        ...fence,
        expectedQueueVersion: 1,
        queueId: "queue-terminal" as FollowUpQueueId,
      })).toMatchObject({ status: "rejected", reason: { code: "stale_version" } });

      fixture.journal.append({
        eventId: `terminal-${terminalState}`,
        boardId: BOARD_ID,
        cardId: CARD_ONE,
        attemptId: fence.attemptId,
        attemptSequence: 2,
        actor: "agent",
        kind: "attempt_activity_committed",
        occurredAt: 900,
        payload: { generation: fence.generation, activity: { kind: "attempt_state", state: terminalState } },
      });
      expect(await coordinator.confirmQueuedFollowUp({
        ...fence,
        expectedQueueVersion: 2,
        queueId: "queue-terminal" as FollowUpQueueId,
      })).toMatchObject({ status: "rejected", reason: { code: "attempt_terminal" } });
      expect(promptCalls).toBe(0);
    }
  });
});

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
        readonly telemetry?: ContentFreeFollowUpTelemetry;
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
