import type { Database } from "bun:sqlite";

export interface SqliteMigration {
  readonly version: number;
  readonly name: string;
  up(database: Database): void;
}

export interface MigrationResult {
  readonly currentVersion: number;
  readonly appliedVersions: readonly number[];
}

interface AppliedMigrationRow {
  readonly version: number;
  readonly name: string;
}

const INITIAL_SCHEMA_SQL = `
  CREATE TABLE boards (
    board_id TEXT PRIMARY KEY,
    repository_path TEXT NOT NULL,
    workflow_version INTEGER NOT NULL CHECK (workflow_version >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
  ) STRICT;

  CREATE TABLE workflow_stages (
    stage_id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(board_id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    default_skill_id TEXT,
    configured INTEGER NOT NULL CHECK (configured IN (0, 1)),
    workflow_version INTEGER NOT NULL CHECK (workflow_version >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
  ) STRICT;

  CREATE TABLE workflow_edges (
    board_id TEXT NOT NULL REFERENCES boards(board_id) ON DELETE CASCADE,
    source_stage_id TEXT NOT NULL REFERENCES workflow_stages(stage_id) ON DELETE CASCADE,
    target_stage_id TEXT NOT NULL REFERENCES workflow_stages(stage_id) ON DELETE CASCADE,
    workflow_version INTEGER NOT NULL CHECK (workflow_version >= 0),
    PRIMARY KEY (board_id, source_stage_id, target_stage_id),
    CHECK (source_stage_id <> target_stage_id)
  ) STRICT;

  CREATE TABLE cards (
    card_id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(board_id) ON DELETE CASCADE,
    stage_id TEXT NOT NULL REFERENCES workflow_stages(stage_id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    effort TEXT NOT NULL,
    skill_override_id TEXT,
    runnable INTEGER NOT NULL CHECK (runnable IN (0, 1)),
    execution_status TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
  ) STRICT;

  CREATE TABLE journal_events (
    journal_order INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    board_id TEXT NOT NULL,
    card_id TEXT,
    attempt_id TEXT,
    attempt_sequence INTEGER,
    actor TEXT NOT NULL,
    kind TEXT NOT NULL,
    occurred_at INTEGER NOT NULL CHECK (occurred_at >= 0),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    CHECK (
      (attempt_id IS NULL AND attempt_sequence IS NULL) OR
      (attempt_id IS NOT NULL AND attempt_sequence IS NOT NULL AND attempt_sequence >= 0)
    )
  ) STRICT;

  CREATE UNIQUE INDEX journal_attempt_sequence_unique
    ON journal_events(attempt_id, attempt_sequence)
    WHERE attempt_id IS NOT NULL;

  CREATE INDEX journal_board_order
    ON journal_events(board_id, journal_order);

  CREATE INDEX journal_card_order
    ON journal_events(card_id, journal_order)
    WHERE card_id IS NOT NULL;

  CREATE TRIGGER journal_events_reject_update
    BEFORE UPDATE ON journal_events
    BEGIN
      SELECT RAISE(ABORT, 'journal events are immutable');
    END;

  CREATE TRIGGER journal_events_reject_delete
    BEFORE DELETE ON journal_events
    BEGIN
      SELECT RAISE(ABORT, 'journal events are immutable');
    END;

  CREATE TABLE projection_metadata (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    last_journal_order INTEGER NOT NULL CHECK (last_journal_order >= 0)
  ) STRICT;

  INSERT INTO projection_metadata(singleton, revision, last_journal_order)
  VALUES (1, 0, 0);
`;

export const DESKTOP_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    name: "initial_desktop_journal_and_projections",
    up(database) {
      database.run(INITIAL_SCHEMA_SQL);
    },
  },
];

function assertOrderedMigrations(migrations: readonly SqliteMigration[]): void {
  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(
        `SQLite migrations must be contiguous and ordered: expected ${expectedVersion}, received ${migration.version}`,
      );
    }
    if (migration.name.trim().length === 0) {
      throw new Error(`SQLite migration ${migration.version} must have a name`);
    }
  });
}

function ensureMigrationTable(database: Database): void {
  const createTable = database.transaction(() => {
    database.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY CHECK (version > 0),
        name TEXT NOT NULL UNIQUE,
        applied_at INTEGER NOT NULL CHECK (applied_at >= 0)
      ) STRICT
    `);
  });
  createTable.immediate();
}

export function readAppliedMigrations(database: Database): readonly AppliedMigrationRow[] {
  return database
    .query<AppliedMigrationRow, []>(
      "SELECT version, name FROM schema_migrations ORDER BY version",
    )
    .all();
}

export function migrateDatabase(
  database: Database,
  options: {
    readonly migrations?: readonly SqliteMigration[];
    readonly now?: () => number;
  } = {},
): MigrationResult {
  const migrations = options.migrations ?? DESKTOP_MIGRATIONS;
  const now = options.now ?? Date.now;
  assertOrderedMigrations(migrations);
  ensureMigrationTable(database);

  const applied = readAppliedMigrations(database);
  applied.forEach((row, index) => {
    const migration = migrations[index];
    if (migration === undefined || migration.version !== row.version || migration.name !== row.name) {
      throw new Error(
        `SQLite migration history diverged at version ${row.version} (${row.name})`,
      );
    }
  });

  const appliedVersions: number[] = [];
  for (const migration of migrations.slice(applied.length)) {
    const applyMigration = database.transaction(() => {
      migration.up(database);
      database.query<void, [number, string, number]>(
        "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.name, now());
    });
    applyMigration.immediate();
    appliedVersions.push(migration.version);
  }

  return {
    currentVersion: migrations.length,
    appliedVersions,
  };
}
