import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AttemptSequenceError,
  DuplicateJournalEventError,
  JournalValidationError,
  createEventJournal,
  type EvidenceBoundReviewDispositionProjection,
  type EventJournalTransaction,
  type BoardProjection,
  type CardProjection,
  type EdgeProjection,
  type JournalEvent,
  type StageProjection,
} from "./eventJournal.ts";
import {
  DESKTOP_MIGRATIONS,
  migrateDatabase,
  readAppliedMigrations,
  type SqliteMigration,
} from "./migrations.ts";
import { rebuildProjections } from "./projectionRebuilder.ts";
import { closeSqliteDatabase, openSqliteDatabase } from "./sqliteDatabase.ts";
import { workflowIds } from "../workflow/workflowTypes.ts";
import {
  parseFollowUpQueueProjection,
} from "../attempts/followUpQueue.ts";
import type { ReviewEvidenceRecord } from "./reviewEvidencePersistence.ts";

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

function hash(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function evidence(
  evidenceId: string,
  createdAt: number,
  patchText = `patch:${evidenceId}\n`,
  generation = 1,
): ReviewEvidenceRecord {
  const patchBlob = new TextEncoder().encode(patchText);
  const patchDigest = hash(patchBlob);
  return {
    evidenceId,
    boardId: BOARD.boardId,
    cardId: CARD.cardId,
    attemptId: `attempt-${generation}` as ReviewEvidenceRecord["attemptId"],
    generation: generation as ReviewEvidenceRecord["generation"],
    worktreeBindingId: `binding-${generation}`,
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40),
    policyVersion: 1,
    evidenceDigest: hash(`evidence:${evidenceId}:${patchText}:${generation}`),
    fileCount: 1,
    totalPatchBytes: patchBlob.byteLength,
    createdAt,
    files: [{
      evidenceId,
      fileIndex: 0,
      fileId: `file-${evidenceId}`,
      status: "modified",
      oldPath: "src/example.ts",
      newPath: "src/example.ts",
      oldMode: "100644",
      newMode: "100644",
      isBinary: false,
      additions: 1,
      deletions: 0,
      patchByteLength: patchBlob.byteLength,
      patchDigest,
      contentDigest: hash(`content:${evidenceId}`),
      patchBlob,
    }],
  };
}

function referenceFor(value: ReviewEvidenceRecord) {
  return {
    evidenceId: value.evidenceId,
    boardId: value.boardId,
    cardId: value.cardId,
    attemptId: value.attemptId,
    generation: value.generation,
    worktreeBindingId: value.worktreeBindingId,
    evidenceDigest: value.evidenceDigest,
    createdAt: value.createdAt,
  };
}

function boundDisposition(
  reviewId: string,
  value: ReviewEvidenceRecord,
  disposition: EvidenceBoundReviewDispositionProjection["disposition"],
  reviewedCardVersion: number,
): EvidenceBoundReviewDispositionProjection {
  return {
    reviewId,
    boardId: value.boardId,
    cardId: value.cardId,
    evidenceId: value.evidenceId,
    evidenceDigest: value.evidenceDigest,
    attemptId: value.attemptId,
    generation: value.generation,
    worktreeBindingId: value.worktreeBindingId,
    disposition,
    reviewer: "operator",
    reviewedCardVersion,
    occurredAt: value.createdAt + 1,
  };
}

function seedCard(journal: ReturnType<typeof createEventJournal>): void {
  journal.append(event("board_upserted", BOARD));
  journal.append(event("stage_upserted", BACKLOG));
  journal.append(event("card_upserted", CARD));
}

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
        currentVersion: 9,
        appliedVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      });
      expect(migrateDatabase(database, { now: () => 99 })).toEqual({
        currentVersion: 9,
        appliedVersions: [],
      });
      expect(readAppliedMigrations(database)).toEqual([
        { version: 1, name: "initial_desktop_journal_and_projections" },
        { version: 2, name: "skill_catalog_projections_and_snapshots" },
        { version: 3, name: "card_owned_worktree_bindings" },
        { version: 4, name: "attempt_admission_and_immutable_run_contexts" },
        { version: 5, name: "normalized_activity_and_inspector_projections" },
        { version: 6, name: "durable_confirmable_follow_up_queue" },
        { version: 7, name: "durable_attention_blockers_and_notification_results" },
        { version: 8, name: "interrupted_attempt_recovery_and_review_dispositions" },
        { version: 9, name: "immutable_review_evidence_and_queue_v2" },
      ]);

      const tables = database.query<{ name: string }, []>(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name
      `).all().map(({ name }) => name);
      expect(tables).toEqual([
        "attempt_inspector_projections",
        "attempts",
        "attention_blocker_projections",
        "boards",
        "card_worktrees",
        "cards",
        "follow_up_queue_projections",
        "journal_events",
        "projection_metadata",
        "review_dispositions",
        "review_evidence",
        "review_evidence_files",
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

  test("upgrades a version-8 database once and normalizes legacy queue rows", () => {
    const database = openSqliteDatabase({ filename: ":memory:" });
    try {
      expect(migrateDatabase(database, {
        migrations: DESKTOP_MIGRATIONS.slice(0, 8),
        now: () => 8,
      })).toEqual({
        currentVersion: 8,
        appliedVersions: [1, 2, 3, 4, 5, 6, 7, 8],
      });
      database.query<void, [string, string, number, number, number]>(`
        INSERT INTO boards(board_id, repository_path, workflow_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(BOARD.boardId, BOARD.repositoryPath, 1, 1, 1);
      database.query<void, [string, string, string, number, null, number, number, number]>(`
        INSERT INTO workflow_stages(
          stage_id, board_id, label, position, default_skill_id,
          configured, workflow_version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(BACKLOG.stageId, BOARD.boardId, BACKLOG.label, 0, null, 1, 1, 1);
      database.query<void, [
        string, string, string, string, string, string, string, string,
        null, number, string, number, number, number,
      ]>(`
        INSERT INTO cards(
          card_id, board_id, stage_id, title, description, provider, model, effort,
          skill_override_id, runnable, execution_status, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        CARD.cardId, BOARD.boardId, BACKLOG.stageId, CARD.title, CARD.description,
        CARD.provider, CARD.model, CARD.effort, null, 1, CARD.executionStatus, 1, 1, 1,
      );
      database.run(`
        INSERT INTO attempts(
          attempt_id, board_id, card_id, generation, state, session_id,
          failure_json, created_at, started_at, terminal_at
        ) VALUES (
          'attempt-legacy', '${BOARD.boardId}', '${CARD.cardId}', 1, 'succeeded',
          NULL, NULL, 1, 1, 2
        )
      `);
      const legacy = {
        schemaVersion: 1,
        boardId: BOARD.boardId,
        cardId: CARD.cardId,
        attemptId: "attempt-legacy",
        generation: 1,
        version: 3,
        turnState: "dispatching",
        drafts: [{
          queueId: "queue-legacy",
          text: "explicit legacy submission",
          state: "confirmed",
          createdAt: 1,
          updatedAt: 2,
          confirmedAt: 2,
          dispatchedAt: null,
          removedAt: null,
        }],
        updatedAt: 2,
      };
      database.query<void, [string, string, string, number, number, string, number]>(`
        INSERT INTO follow_up_queue_projections(
          attempt_id, board_id, card_id, generation, version, projection_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        "attempt-legacy",
        BOARD.boardId,
        CARD.cardId,
        1,
        3,
        JSON.stringify(legacy),
        2,
      );
      database.run(`
        INSERT INTO review_dispositions(
          review_id, board_id, card_id, disposition, reviewer,
          reviewed_card_version, occurred_at
        ) VALUES (
          'legacy-review', '${BOARD.boardId}', '${CARD.cardId}',
          'approved', 'operator', 1, 3
        )
      `);

      expect(migrateDatabase(database, { now: () => 9 })).toEqual({
        currentVersion: 9,
        appliedVersions: [9],
      });
      expect(migrateDatabase(database, { now: () => 10 })).toEqual({
        currentVersion: 9,
        appliedVersions: [],
      });
      const persisted = database.query<{ projectionJson: string }, []>(`
        SELECT projection_json AS projectionJson FROM follow_up_queue_projections
      `).get()!;
      expect(parseFollowUpQueueProjection(persisted.projectionJson)).toMatchObject({
        schemaVersion: 2,
        version: 3,
        drafts: [{ queueId: "queue-legacy", state: "interrupted" }],
      });
      expect(createEventJournal(database).snapshot().reviewDispositions).toEqual([{
        reviewId: "legacy-review",
        boardId: BOARD.boardId,
        cardId: CARD.cardId,
        evidenceId: null,
        evidenceDigest: null,
        attemptId: null,
        generation: null,
        worktreeBindingId: null,
        disposition: "approved",
        reviewer: "operator",
        reviewedCardVersion: 1,
        occurredAt: 3,
      }]);
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

describe("immutable review evidence persistence", () => {
  test("persists exact replays idempotently and rejects identity reuse with different metadata or bytes", () => {
    const database = migratedMemoryDatabase();
    const journal = createEventJournal(database);
    const first = evidence("evidence-idempotent", 300);
    try {
      expect(journal.immediate((transaction) => (
        transaction.persistReviewEvidence(first)
      ))).toBe("inserted");
      expect(journal.immediate((transaction) => (
        transaction.persistReviewEvidence(first)
      ))).toBe("idempotent");
      expect(() => journal.immediate((transaction) => (
        transaction.persistReviewEvidence({
          ...first,
          baseCommit: "c".repeat(40),
        })
      ))).toThrow("Review evidence identity conflict");
      const conflictingPatch = new TextEncoder().encode("different patch bytes\n");
      expect(() => journal.immediate((transaction) => (
        transaction.persistReviewEvidence({
          ...first,
          totalPatchBytes: conflictingPatch.byteLength,
          files: [{
            ...first.files[0]!,
            patchByteLength: conflictingPatch.byteLength,
            patchDigest: hash(conflictingPatch),
            patchBlob: conflictingPatch,
          }],
        })
      ))).toThrow("Review evidence identity conflict");
      expect(journal.reviewEvidence(first.evidenceId)).toEqual(first);
    } finally {
      closeSqliteDatabase(database);
    }
  });

  test("rejects invalid identities, counts, ordering, duplicate IDs, totals, and foreign keys", () => {
    const database = migratedMemoryDatabase();
    const journal = createEventJournal(database);
    const valid = evidence("evidence-invalid-cases", 300);
    const secondFile = {
      ...valid.files[0]!,
      fileIndex: 1,
      fileId: "file-second",
    };
    try {
      for (const candidate of [
        { ...valid, evidenceId: "" },
        { ...valid, fileCount: -1 },
        { ...valid, fileCount: 2 },
        { ...valid, totalPatchBytes: valid.totalPatchBytes + 1 },
        {
          ...valid,
          fileCount: 2,
          totalPatchBytes: valid.totalPatchBytes * 2,
          files: [valid.files[0]!, { ...secondFile, fileIndex: 0 }],
        },
        {
          ...valid,
          fileCount: 2,
          totalPatchBytes: valid.totalPatchBytes * 2,
          files: [valid.files[0]!, { ...secondFile, fileId: valid.files[0]!.fileId }],
        },
      ]) {
        expect(() => journal.immediate((transaction) => (
          transaction.persistReviewEvidence(candidate)
        ))).toThrow();
      }
      expect(() => database.run(`
        INSERT INTO review_evidence_files(
          evidence_id, file_index, file_id, status, old_path, new_path,
          old_mode, new_mode, is_binary, additions, deletions, patch_size,
          patch_digest, content_digest, patch_blob
        ) VALUES (
          'missing-evidence', 0, 'file-orphan', 'modified', 'a', 'a',
          '100644', '100644', 0, 1, 0, 1, '${"a".repeat(64)}', NULL, x'00'
        )
      `)).toThrow("FOREIGN KEY");
      expect(() => database.run(`
        INSERT INTO review_evidence(
          evidence_id, board_id, card_id, attempt_id, generation, worktree_binding_id,
          base_commit, head_commit, policy_version, evidence_digest,
          file_count, patch_bytes, created_at
        ) VALUES (
          'negative-count', 'board', 'card', 'attempt', 0, 'binding',
          'base', 'head', 1, '${"b".repeat(64)}', -1, 0, 1
        )
      `)).toThrow("CHECK constraint");
      expect(journal.snapshot().reviewEvidenceByCard).toEqual({});
    } finally {
      closeSqliteDatabase(database);
    }
  });

  test("rejects updates and deletes for manifests and file rows", () => {
    const database = migratedMemoryDatabase();
    const journal = createEventJournal(database);
    const value = evidence("evidence-immutable", 300);
    try {
      journal.immediate((transaction) => transaction.persistReviewEvidence(value));
      expect(() => database.query(`
        UPDATE review_evidence SET head_commit = 'changed' WHERE evidence_id = ?
      `).run(value.evidenceId)).toThrow("review evidence is immutable");
      expect(() => database.query(`
        DELETE FROM review_evidence WHERE evidence_id = ?
      `).run(value.evidenceId)).toThrow("review evidence is immutable");
      expect(() => database.query(`
        UPDATE review_evidence_files SET old_path = 'changed'
        WHERE evidence_id = ? AND file_index = 0
      `).run(value.evidenceId)).toThrow("review evidence files are immutable");
      expect(() => database.query(`
        DELETE FROM review_evidence_files WHERE evidence_id = ? AND file_index = 0
      `).run(value.evidenceId)).toThrow("review evidence files are immutable");
      expect(journal.reviewEvidence(value.evidenceId)).toEqual(value);
    } finally {
      closeSqliteDatabase(database);
    }
  });

  test("rolls back evidence, reference, lifecycle, and disposition after a later write fails", () => {
    const database = migratedMemoryDatabase();
    const journal = createEventJournal(database);
    const value = evidence("evidence-rollback", 300);
    try {
      seedCard(journal);
      const before = journal.snapshot();
      const ready = {
        ...CARD,
        executionStatus: "ready_for_review" as const,
        version: CARD.version + 1,
        updatedAt: value.createdAt,
      };
      const disposition = boundDisposition(
        "review-rollback",
        value,
        "changes_requested",
        ready.version,
      );
      expect(() => journal.immediate((transaction) => {
        transaction.persistReviewEvidence(value);
        transaction.append({
          eventId: `evidence:${value.evidenceId}`,
          boardId: value.boardId,
          cardId: value.cardId,
          actor: "system",
          kind: "review_evidence_committed",
          occurredAt: value.createdAt,
          payload: {
            evidence: referenceFor(value),
            changes: [{ entity: "card", operation: "upsert", value: ready }],
          },
        });
        transaction.append({
          eventId: `review:${disposition.reviewId}`,
          boardId: disposition.boardId,
          cardId: disposition.cardId,
          actor: "operator",
          kind: "review_disposition_committed",
          occurredAt: disposition.occurredAt,
          payload: {
            changes: [{
              entity: "review_disposition",
              operation: "insert",
              value: disposition,
            }],
          },
        });
        transaction.persistReviewEvidence({ ...value, headCommit: "c".repeat(40) });
      })).toThrow("Review evidence identity conflict");
      expect(journal.snapshot()).toEqual(before);
      expect(journal.reviewEvidence(value.evidenceId)).toBeNull();
      expect(journal.eventById(`evidence:${value.evidenceId}`)).toBeNull();
      expect(journal.eventById(`review:${disposition.reviewId}`)).toBeNull();
    } finally {
      closeSqliteDatabase(database);
    }
  });

  test("keeps transaction operations scoped to one synchronous immediate callback", () => {
    const database = migratedMemoryDatabase();
    const journal = createEventJournal(database);
    const value = evidence("evidence-transaction-scope", 300);
    let leaked: EventJournalTransaction | undefined;
    try {
      journal.immediate((transaction) => {
        leaked = transaction;
      });
      expect(() => leaked!.persistReviewEvidence(value)).toThrow(
        "require an active immediate callback",
      );
      expect(() => journal.immediate(async (transaction) => {
        transaction.persistReviewEvidence(value);
      })).toThrow("must be synchronous");
      expect(journal.reviewEvidence(value.evidenceId)).toBeNull();
    } finally {
      closeSqliteDatabase(database);
    }
  });

  test("rebuilds repeated change requests and eventual approval without patch blobs", () => {
    const database = migratedMemoryDatabase();
    const journal = createEventJournal(database);
    const rounds = [
      evidence("evidence-round-1", 300, "round one patch\n", 1),
      evidence("evidence-round-2", 400, "round two patch\n", 2),
      evidence("evidence-round-3", 500, "round three patch\n", 3),
    ];
    try {
      seedCard(journal);
      let currentCard = CARD;
      rounds.forEach((value, index) => {
        currentCard = {
          ...currentCard,
          executionStatus: "ready_for_review",
          version: currentCard.version + 1,
          updatedAt: value.createdAt,
        };
        journal.immediate((transaction) => {
          transaction.persistReviewEvidence(value);
          transaction.append({
            eventId: `evidence:${value.evidenceId}`,
            boardId: value.boardId,
            cardId: value.cardId,
            actor: "system",
            kind: "review_evidence_committed",
            occurredAt: value.createdAt,
            payload: {
              evidence: referenceFor(value),
              changes: [{ entity: "card", operation: "upsert", value: currentCard }],
            },
          });
          const disposition = boundDisposition(
            `review-round-${index + 1}`,
            value,
            index === rounds.length - 1 ? "approved" : "changes_requested",
            currentCard.version,
          );
          const completed = {
            ...currentCard,
            executionStatus: "completed" as const,
            version: currentCard.version + 1,
            updatedAt: disposition.occurredAt,
          };
          transaction.append({
            eventId: `review:${disposition.reviewId}`,
            boardId: disposition.boardId,
            cardId: disposition.cardId,
            actor: "operator",
            kind: "review_disposition_committed",
            occurredAt: disposition.occurredAt,
            payload: {
              changes: [
                {
                  entity: "review_disposition",
                  operation: "insert",
                  value: disposition,
                },
                ...(disposition.disposition === "approved"
                  ? [{ entity: "card" as const, operation: "upsert" as const, value: completed }]
                  : []),
              ],
            },
          });
          if (disposition.disposition === "approved") currentCard = completed;
        });
      });

      const live = journal.snapshot();
      expect(live.reviewDispositions.map(({ disposition }) => disposition)).toEqual([
        "changes_requested",
        "changes_requested",
        "approved",
      ]);
      expect(live.reviewEvidenceByCard[CARD.cardId]?.evidenceId).toBe("evidence-round-3");
      const serializedSnapshot = JSON.stringify(live);
      expect(serializedSnapshot).not.toContain("round one patch");
      expect(serializedSnapshot).not.toContain("round two patch");
      expect(serializedSnapshot).not.toContain("round three patch");
      expect(JSON.stringify(journal.events())).not.toContain("round three patch");
      expect(rebuildProjections(database)).toEqual(live);
    } finally {
      closeSqliteDatabase(database);
    }
  });
});

describe("snapshot, reopen, and deterministic projection rebuild", () => {
  test("reopens the latest evidence summary by created time then evidence identity", () => {
    withTemporaryDatabase((filename) => {
      const database = openSqliteDatabase({ filename });
      migrateDatabase(database);
      const journal = createEventJournal(database);
      const older = evidence("evidence-a", 300);
      const tiedLower = evidence("evidence-b", 400);
      const tiedHigher = evidence("evidence-c", 400);
      journal.immediate((transaction) => {
        transaction.persistReviewEvidence(tiedHigher);
        transaction.persistReviewEvidence(older);
        transaction.persistReviewEvidence(tiedLower);
      });
      expect(journal.snapshot().reviewEvidenceByCard[CARD.cardId]).toMatchObject({
        evidenceId: tiedHigher.evidenceId,
        createdAt: 400,
      });
      closeSqliteDatabase(database);

      const reopened = openSqliteDatabase({ filename });
      try {
        expect(createEventJournal(reopened).snapshot().reviewEvidenceByCard[CARD.cardId]).toEqual({
          evidenceId: tiedHigher.evidenceId,
          boardId: tiedHigher.boardId,
          cardId: tiedHigher.cardId,
          attemptId: tiedHigher.attemptId,
          generation: tiedHigher.generation,
          worktreeBindingId: tiedHigher.worktreeBindingId,
          baseCommit: tiedHigher.baseCommit,
          headCommit: tiedHigher.headCommit,
          policyVersion: tiedHigher.policyVersion,
          evidenceDigest: tiedHigher.evidenceDigest,
          fileCount: tiedHigher.fileCount,
          totalPatchBytes: tiedHigher.totalPatchBytes,
          createdAt: tiedHigher.createdAt,
        });
      } finally {
        closeSqliteDatabase(reopened);
      }
    });
  });

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
