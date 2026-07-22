import { afterEach, describe, expect, test } from "bun:test";
import {
  toActivitySequence,
  toAttemptGeneration,
  toOpaqueId,
  type ActivityEventId,
  type AttemptId,
  type ProfileId,
} from "@kitten/engine";
import {
  createEventJournal,
  type EventJournal,
} from "../persistence/eventJournal.ts";
import { migrateDatabase } from "../persistence/migrations.ts";
import { closeSqliteDatabase, openSqliteDatabase } from "../persistence/sqliteDatabase.ts";
import { workflowIds, type CardProjection } from "../workflow/workflowTypes.ts";
import type { RunContext } from "./contracts.ts";
import { createActivityIngestor } from "./activityIngestor.ts";

const databases: ReturnType<typeof openSqliteDatabase>[] = [];
afterEach(() => {
  while (databases.length > 0) closeSqliteDatabase(databases.pop()!);
});

const BOARD_ID = workflowIds.board("board-activity");
const STAGE_ID = workflowIds.stage("stage-activity");
const CARD_ID = workflowIds.card("card-activity");
const ATTEMPT_ID = toOpaqueId<AttemptId>("attempt-activity")!;
const GENERATION = toAttemptGeneration(1)!;
const SKILL_ID = workflowIds.skill(`skill:${"a".repeat(64)}`);

function fixture() {
  const database = openSqliteDatabase({ filename: ":memory:" });
  databases.push(database);
  migrateDatabase(database, { now: () => 1 });
  const journal = createEventJournal(database);
  seed(journal);
  return { database, journal, ingestor: createActivityIngestor({ journal }) };
}

function activity(sequence: number, payload: unknown, overrides: Record<string, unknown> = {}) {
  return {
    eventId: toOpaqueId<ActivityEventId>(`activity-event-${sequence}`)!,
    attemptId: ATTEMPT_ID,
    generation: GENERATION,
    sequence: toActivitySequence(sequence)!,
    occurredAt: 200 + sequence,
    activity: payload,
    ...overrides,
  };
}

describe("validated activity ingestion", () => {
  test("rejects unknown, stale, gap, malformed, duplicate, regression, and post-terminal input without mutation", async () => {
    const { journal, ingestor } = fixture();
    const baseline = journal.snapshot();
    const baselineEvents = journal.events().length;

    expect(await ingestor.ingest(activity(2, { kind: "agent_message", messageId: "m", textDelta: "x" }, {
      attemptId: "attempt-unknown",
    }))).toMatchObject({ status: "rejected", reason: "unknown_attempt" });
    expect(await ingestor.ingest(activity(2, { kind: "agent_message", messageId: "m", textDelta: "x" }, {
      generation: toAttemptGeneration(0),
    }))).toMatchObject({ status: "rejected", reason: "stale_generation" });
    expect(await ingestor.ingest(activity(3, { kind: "agent_message", messageId: "m", textDelta: "gap" }))).toMatchObject({
      status: "rejected", reason: "sequence_gap",
    });
    expect(await ingestor.ingest({
      ...activity(2, { kind: "agent_message", messageId: "m", textDelta: "wire" }),
      acpSessionUpdate: {},
    })).toMatchObject({ status: "rejected", reason: "malformed_payload" });
    expect(journal.events()).toHaveLength(baselineEvents);
    expect(journal.snapshot()).toEqual(baseline);

    const accepted = await ingestor.ingest(activity(2, {
      kind: "agent_message", messageId: "message-1", textDelta: "accepted",
    }));
    expect(accepted.status).toBe("committed");
    const afterAccepted = journal.snapshot();
    const acceptedEventCount = journal.events().length;
    expect(await ingestor.ingest(activity(2, {
      kind: "agent_message", messageId: "message-1", textDelta: "accepted",
    }))).toMatchObject({ status: "rejected", reason: "duplicate_event_id" });
    expect(await ingestor.ingest(activity(2, {
      kind: "agent_message", messageId: "message-other", textDelta: "regression",
    }, { eventId: "new-regression-id" }))).toMatchObject({ status: "rejected", reason: "non_monotonic" });
    expect(journal.events()).toHaveLength(acceptedEventCount);
    expect(journal.snapshot()).toEqual(afterAccepted);

    expect(await ingestor.ingest(activity(3, { kind: "attempt_state", state: "succeeded" }))).toMatchObject({
      status: "committed",
      inspector: { terminalOutcome: "succeeded" },
    });
    const terminal = journal.snapshot();
    const terminalEventCount = journal.events().length;
    expect(await ingestor.ingest(activity(4, {
      kind: "agent_message", messageId: "message-late", textDelta: "late",
    }))).toMatchObject({ status: "rejected", reason: "post_terminal" });
    expect(journal.events()).toHaveLength(terminalEventCount);
    expect(journal.snapshot()).toEqual(terminal);
    expect(terminal.attempts[0]?.state).toBe("succeeded");
    expect(terminal.cards[0]?.executionStatus).toBe("running");
  });

  test("binds activity to the subscribed attempt and generation", async () => {
    const { ingestor } = fixture();
    expect(await ingestor.ingest(activity(2, {
      kind: "agent_message", messageId: "m", textDelta: "wrong route",
    }), {
      attemptId: toOpaqueId<AttemptId>("other-attempt")!,
      generation: GENERATION,
    })).toMatchObject({ status: "rejected", reason: "unknown_attempt" });
    expect(await ingestor.ingest(activity(2, {
      kind: "agent_message", messageId: "m", textDelta: "stale route",
    }), {
      attemptId: ATTEMPT_ID,
      generation: toAttemptGeneration(2)!,
    })).toMatchObject({ status: "rejected", reason: "stale_generation" });
  });

  test("atomically persists failure outcome, inspector evidence, attempt state, and card settlement", async () => {
    const { journal, ingestor } = fixture();
    expect(await ingestor.ingest(activity(2, { kind: "attempt_state", state: "failed" }))).toMatchObject({
      status: "committed",
      inspector: { terminalOutcome: "failed" },
    });
    const snapshot = journal.snapshot();
    expect(snapshot.attemptInspectors[0]?.entries[0]).toMatchObject({ kind: "terminal", outcome: "failed" });
    expect(snapshot.attempts[0]).toMatchObject({
      state: "failed",
      failure: { code: "activity_failed" },
      terminalAt: 202,
    });
    expect(snapshot.cards[0]).toMatchObject({ executionStatus: "failed", version: 3 });
    const journalEvent = journal.events().at(-1);
    expect(journalEvent).toMatchObject({
      eventId: "activity-event-2",
      kind: "attempt_activity_committed",
      attemptSequence: 2,
    });
  });
});

function seed(journal: EventJournal): void {
  const card: CardProjection = {
    cardId: CARD_ID,
    boardId: BOARD_ID,
    stageId: STAGE_ID,
    title: "Persist activity",
    description: "Fixture",
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
  journal.append({
    eventId: "seed-board", boardId: BOARD_ID, actor: "operator", kind: "board_upserted", occurredAt: 1,
    payload: { boardId: BOARD_ID, repositoryPath: "/tmp/repository", workflowVersion: 1, createdAt: 1, updatedAt: 1 },
  });
  journal.append({
    eventId: "seed-stage", boardId: BOARD_ID, actor: "operator", kind: "stage_upserted", occurredAt: 2,
    payload: {
      stageId: STAGE_ID, boardId: BOARD_ID, label: "Doing", position: 0, defaultSkillId: SKILL_ID,
      configured: true, workflowVersion: 1, updatedAt: 2,
    },
  });
  journal.append({
    eventId: "seed-card", boardId: BOARD_ID, cardId: CARD_ID, actor: "operator",
    kind: "card_upserted", occurredAt: 3, payload: card,
  });
  const runContext = context();
  const starting = {
    attemptId: ATTEMPT_ID,
    boardId: BOARD_ID,
    cardId: CARD_ID,
    generation: GENERATION,
    state: "starting" as const,
    sessionId: null,
    failure: null,
    createdAt: 100,
    startedAt: null,
    terminalAt: null,
  };
  journal.append({
    eventId: "attempt-created", boardId: BOARD_ID, cardId: CARD_ID, attemptId: ATTEMPT_ID,
    attemptSequence: 0, actor: "system", kind: "attempt_lifecycle_committed", occurredAt: 100,
    payload: {
      operation: "created",
      changes: [
        { entity: "card", operation: "upsert", value: { ...card, executionStatus: "running", version: 2, updatedAt: 100 } },
        { entity: "attempt", operation: "upsert", value: starting },
        { entity: "run_context", operation: "insert", value: runContext },
      ],
    },
  });
  journal.append({
    eventId: "attempt-started", boardId: BOARD_ID, cardId: CARD_ID, attemptId: ATTEMPT_ID,
    attemptSequence: 1, actor: "system", kind: "attempt_lifecycle_committed", occurredAt: 101,
    payload: {
      operation: "started",
      changes: [{
        entity: "attempt",
        operation: "upsert",
        value: { ...starting, state: "running", sessionId: "session-1", startedAt: 101 },
      }],
    },
  });
}

function context(): RunContext {
  return {
    schemaVersion: 1,
    attemptId: ATTEMPT_ID,
    generation: GENERATION,
    capturedAt: 100,
    card: { cardId: CARD_ID, title: "Persist activity", description: "Fixture", version: 1 },
    stage: { stageId: STAGE_ID, label: "Doing" },
    workflow: { boardId: BOARD_ID, version: 1 },
    skill: {
      snapshotId: SKILL_ID,
      skillId: SKILL_ID,
      canonicalPath: "/tmp/repository/.agents/skills/fixture/SKILL.md",
      rootClass: "project",
      digest: "a".repeat(64),
      metadata: { name: "fixture", description: "Fixture", frontmatter: { name: "fixture" } },
      content: "Execute fixture",
    },
    profile: {
      profileId: "profile-codex" as ProfileId,
      provider: "codex",
      model: "gpt-5",
      effort: "high",
      protocolVersion: 1,
      recipeId: "codex-acp",
      adapterVersion: "1.2.3",
      readinessCheckedAt: 90,
    },
    repository: { trusted: true, canonicalPath: "/tmp/repository", checkedAt: 90, message: "verified" },
    worktree: {
      bindingVersion: 1,
      bindingId: "kw-activity000001",
      boardId: BOARD_ID,
      cardId: CARD_ID,
      repositoryRoot: "/tmp/repository",
      repositoryGitDir: "/tmp/repository/.git",
      managedRoot: "/tmp/repository/.kitten/worktrees/cards",
      worktreePath: "/tmp/repository/.kitten/worktrees/cards/kw-activity000001",
      branch: "kitten/card/kw-activity000001",
      baselineBranch: "main",
      baselineCommit: "b".repeat(40),
      lifecycle: "active",
      reason: null,
      createdAt: 90,
      updatedAt: 90,
    },
  };
}
