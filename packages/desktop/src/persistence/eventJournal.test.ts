import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AttemptSequenceError,
  DuplicateJournalEventError,
  JournalValidationError,
  createEventJournal,
  type BoardProjection,
  type CardProjection,
  type EdgeProjection,
  type JournalEvent,
  type StageProjection,
} from "./eventJournal.ts";
import {
  migrateDatabase,
  readAppliedMigrations,
  type SqliteMigration,
} from "./migrations.ts";
import { rebuildProjections } from "./projectionRebuilder.ts";
import { closeSqliteDatabase, openSqliteDatabase } from "./sqliteDatabase.ts";
import { workflowIds } from "../workflow/workflowTypes.ts";

const BOARD: BoardProjection = {
  boardId: workflowIds.board("board-1"),
  repositoryPath: "/tmp/trusted-repository",
  workflowVersion: 1,
  createdAt: 100,
  updatedAt: 100,
};

const BACKLOG: StageProjection = {
  stageId: workflowIds.stage("stage-backlog"),
  boardId: BOARD.boardId,
  label: "Backlog",
  position: 0,
  defaultSkillId: workflowIds.skill(`skill:${"a".repeat(64)}`),
  configured: true,
  workflowVersion: 1,
  updatedAt: 110,
};

const DOING: StageProjection = {
  ...BACKLOG,
  stageId: workflowIds.stage("stage-doing"),
  label: "Doing",
  position: 1,
  defaultSkillId: workflowIds.skill(`skill:${"b".repeat(64)}`),
};

const EDGE: EdgeProjection = {
  boardId: BOARD.boardId,
  sourceStageId: BACKLOG.stageId,
  targetStageId: DOING.stageId,
  workflowVersion: 1,
};

const CARD: CardProjection = {
  cardId: workflowIds.card("card-1"),
  boardId: BOARD.boardId,
  stageId: BACKLOG.stageId,
  title: "Build persistence",
  description: "Journal every accepted change.",
  provider: "codex",
  model: "gpt-5",
  effort: "high",
  skillOverrideId: null,
  runnable: true,
  executionStatus: "idle",
  version: 1,
  createdAt: 120,
  updatedAt: 120,
};

type ProjectionJournalEvent = Extract<JournalEvent, {
  kind: "board_upserted" | "stage_upserted" | "edge_upserted" | "card_upserted";
}>;

function event<TKind extends ProjectionJournalEvent["kind"]>(
  kind: TKind,
  payload: Extract<ProjectionJournalEvent, { kind: TKind }>["payload"],
  overrides: Partial<Extract<ProjectionJournalEvent, { kind: TKind }>> = {},
): Extract<ProjectionJournalEvent, { kind: TKind }> {
  const cardIdentity = kind === "card_upserted"
    ? { cardId: (payload as CardProjection).cardId }
    : {};
  return {
    eventId: `event-${kind}`,
    boardId: payload.boardId,
    actor: "operator",
    kind,
    occurredAt: 200,
    payload,
    ...cardIdentity,
    ...overrides,
  } as Extract<ProjectionJournalEvent, { kind: TKind }>;
}

function migratedMemoryDatabase(): Database {
  const database = openSqliteDatabase({ filename: ":memory:" });
  migrateDatabase(database, { now: () => 1_000 });
  return database;
}

function withTemporaryDatabase(run: (filename: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "kitten-desktop-sqlite-"));
  try {
    run(join(directory, "desktop.sqlite"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("desktop SQLite factory and migrations", () => {
  test("uses the injectable package-local factory and rejects an empty filename", () => {
    let opened: { filename: string; options: unknown } | undefined;
    const database = openSqliteDatabase({
      filename: ":memory:",
      openDatabase(filename, options) {
        opened = { filename, options };
        return new Database(filename, options);
      },
    });
    expect(opened).toEqual({
      filename: ":memory:",
      options: { readonly: false, create: true, strict: true },
    });
    closeSqliteDatabase(database);
    expect(() => database.run("SELECT 1")).toThrow("Database has closed");
    expect(() => openSqliteDatabase({ filename: "   " })).toThrow("must not be empty");
  });

  test("applies ordered migrations once and records the current version", () => {
    const database = openSqliteDatabase({ filename: ":memory:" });
    try {
      expect(migrateDatabase(database, { now: () => 55 })).toEqual({
        currentVersion: 4,
        appliedVersions: [1, 2, 3, 4],
      });
      expect(migrateDatabase(database, { now: () => 99 })).toEqual({
        currentVersion: 4,
        appliedVersions: [],
      });
      expect(readAppliedMigrations(database)).toEqual([
        { version: 1, name: "initial_desktop_journal_and_projections" },
        { version: 2, name: "skill_catalog_projections_and_snapshots" },
        { version: 3, name: "card_owned_worktree_bindings" },
        { version: 4, name: "attempt_admission_and_immutable_run_contexts" },
      ]);

      const tables = database.query<{ name: string }, []>(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name
      `).all().map(({ name }) => name);
      expect(tables).toEqual([
        "attempts",
        "boards",
        "card_worktrees",
        "cards",
        "journal_events",
        "projection_metadata",
        "run_contexts",
        "schema_migrations",
        "skill_catalog_diagnostics",
        "skill_catalog_entries",
        "skill_catalog_roots",
        "skill_snapshots",
        "workflow_edges",
        "workflow_stages",
      ]);
      expect(tables).toContain("attempts");
    } finally {
      closeSqliteDatabase(database);
    }
  });

  test("rejects unordered or divergent migration histories", () => {
    const database = openSqliteDatabase({ filename: ":memory:" });
    try {
      expect(() => migrateDatabase(database, {
        migrations: [{ version: 2, name: "wrong", up() {} }],
      })).toThrow("contiguous and ordered");
      expect(() => migrateDatabase(database, {
        migrations: [{ version: 1, name: " ", up() {} }],
      })).toThrow("must have a name");

      migrateDatabase(database, {
        migrations: [{ version: 1, name: "original", up(db) { db.run("CREATE TABLE original(id INTEGER)"); } }],
      });
      expect(() => migrateDatabase(database, {
        migrations: [{ version: 1, name: "renamed", up() {} }],
      })).toThrow("history diverged");
    } finally {
      closeSqliteDatabase(database);
    }
  });

  test("rolls back a failed migration without recording its version or partial schema", () => {
    const database = openSqliteDatabase({ filename: ":memory:" });
    const migrations: readonly SqliteMigration[] = [
      {
        version: 1,
        name: "stable",
        up(db) {
          db.run("CREATE TABLE stable(id INTEGER PRIMARY KEY)");
        },
      },
      {
        version: 2,
        name: "fails",
        up(db) {
          db.run("CREATE TABLE must_rollback(id INTEGER PRIMARY KEY)");
          throw new Error("injected migration failure");
        },
      },
    ];
    try {
      expect(() => migrateDatabase(database, { migrations, now: () => 1 })).toThrow(
        "injected migration failure",
      );
      expect(readAppliedMigrations(database)).toEqual([{ version: 1, name: "stable" }]);
      expect(database.query<{ count: number }, []>(`
        SELECT count(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name = 'must_rollback'
      `).get()?.count).toBe(0);
    } finally {
      closeSqliteDatabase(database);
    }
  });
});

describe("immutable event journal", () => {
  test("rejects malformed identity, actor, kind, timestamp, payload, and attempt metadata", () => {
    const database = migratedMemoryDatabase();
    const journal = createEventJournal(database);
    const valid = event("board_upserted", BOARD);
    const malformed: unknown[] = [
      { ...valid, eventId: "" },
      { ...valid, actor: "renderer" },
      { ...valid, kind: "unknown" },
      { ...valid, occurredAt: -1 },
      { ...valid, boardId: "another-board" },
      { ...valid, payload: { ...BOARD, unexpected: true } },
      { ...valid, attemptId: "attempt-1" },
      { ...valid, cardId: "card-not-allowed" },
    ];
    try {
      for (const candidate of malformed) {
        expect(() => journal.append(candidate)).toThrow(JournalValidationError);
      }
      expect(journal.events()).toEqual([]);
    } finally {
      closeSqliteDatabase(database);
    }
  });

  test("fails closed on duplicate IDs and duplicate or non-monotonic attempt sequences", () => {
    const database = migratedMemoryDatabase();
    const journal = createEventJournal(database);
    const first = event("board_upserted", BOARD, {
      eventId: "event-sequence-0",
      attemptId: "attempt-1",
      attemptSequence: 0,
    });
    try {
      journal.append(first);
      expect(() => journal.append(first)).toThrow(DuplicateJournalEventError);
      journal.append(event("board_upserted", { ...BOARD, updatedAt: 201 }, {
        eventId: "event-sequence-2",
        attemptId: "attempt-1",
        attemptSequence: 2,
      }));
      expect(() => journal.append(event("board_upserted", { ...BOARD, updatedAt: 202 }, {
        eventId: "event-sequence-1",
        attemptId: "attempt-1",
        attemptSequence: 1,
      }))).toThrow(AttemptSequenceError);
      expect(() => journal.append(event("board_upserted", { ...BOARD, updatedAt: 203 }, {
        eventId: "event-sequence-2-duplicate",
        attemptId: "attempt-1",
        attemptSequence: 2,
      }))).toThrow(AttemptSequenceError);
      expect(journal.events()).toHaveLength(2);
    } finally {
      closeSqliteDatabase(database);
    }
  });

  test("rejects direct updates and deletes of persisted journal evidence", () => {
    const database = migratedMemoryDatabase();
    const journal = createEventJournal(database);
    try {
      journal.append(event("board_upserted", BOARD));
      expect(() => database.run(
        "UPDATE journal_events SET actor = 'system' WHERE event_id = 'event-board_upserted'",
      )).toThrow("journal events are immutable");
      expect(() => database.run(
        "DELETE FROM journal_events WHERE event_id = 'event-board_upserted'",
      )).toThrow("journal events are immutable");
      expect(journal.events()).toEqual([event("board_upserted", BOARD)]);
    } finally {
      closeSqliteDatabase(database);
    }
  });

  test("rolls back journal evidence when its paired projection write fails", () => {
    const database = migratedMemoryDatabase();
    const journal = createEventJournal(database);
    try {
      expect(() => journal.append(event("stage_upserted", BACKLOG))).toThrow();
      expect(journal.events()).toEqual([]);
      expect(journal.snapshot()).toMatchObject({ revision: 0, lastJournalOrder: 0, stages: [] });
    } finally {
      closeSqliteDatabase(database);
    }
  });
});

describe("snapshot, reopen, and deterministic projection rebuild", () => {
  test("returns a committed delta and reopens the same comparison-friendly snapshot", () => {
    withTemporaryDatabase((filename) => {
      const database = openSqliteDatabase({ filename });
      migrateDatabase(database);
      const journal = createEventJournal(database);
      const delta = journal.append(event("board_upserted", BOARD));
      expect(delta).toEqual({
        eventId: "event-board_upserted",
        journalOrder: 1,
        revision: 1,
        changes: [{ entity: "board", operation: "upsert", value: BOARD }],
      });

      const observer = openSqliteDatabase({ filename, readonly: true });
      try {
        expect(createEventJournal(observer).snapshot().boards).toEqual([BOARD]);
      } finally {
        closeSqliteDatabase(observer);
      }
      const beforeClose = journal.snapshot();
      closeSqliteDatabase(database);

      const reopened = openSqliteDatabase({ filename });
      try {
        expect(migrateDatabase(reopened).appliedVersions).toEqual([]);
        expect(createEventJournal(reopened).snapshot()).toEqual(beforeClose);
      } finally {
        closeSqliteDatabase(reopened);
      }
    });
  });

  test("replays ordered events to reproduce live board, stage, edge, and card projections", () => {
    const database = migratedMemoryDatabase();
    const journal = createEventJournal(database);
    try {
      journal.append(event("board_upserted", BOARD));
      journal.append(event("stage_upserted", BACKLOG));
      journal.append(event("stage_upserted", DOING, { eventId: "event-stage-doing" }));
      journal.append(event("edge_upserted", EDGE));
      journal.append(event("card_upserted", CARD));
      const live = journal.snapshot();

      database.run("UPDATE boards SET repository_path = '/tmp/corrupt'");
      database.run("DELETE FROM cards");
      expect(journal.snapshot()).not.toEqual(live);

      expect(rebuildProjections(database)).toEqual(live);
      expect(journal.snapshot()).toEqual(live);
      expect(journal.events()).toEqual([
        event("board_upserted", BOARD),
        event("stage_upserted", BACKLOG),
        event("stage_upserted", DOING, { eventId: "event-stage-doing" }),
        event("edge_upserted", EDGE),
        event("card_upserted", CARD),
      ]);
    } finally {
      closeSqliteDatabase(database);
    }
  });
});
