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

const SKILL_CATALOG_SCHEMA_SQL = `
  CREATE TABLE skill_catalog_roots (
    catalog_id TEXT NOT NULL,
    root_order INTEGER NOT NULL CHECK (root_order >= 0),
    root_class TEXT NOT NULL CHECK (root_class IN ('project', 'user')),
    configured_path TEXT NOT NULL,
    canonical_path TEXT,
    valid INTEGER NOT NULL CHECK (valid IN (0, 1)),
    diagnostics_json TEXT NOT NULL CHECK (json_valid(diagnostics_json)),
    PRIMARY KEY (catalog_id, root_order),
    UNIQUE (catalog_id, root_class, configured_path)
  ) STRICT;

  CREATE TABLE skill_catalog_entries (
    catalog_id TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    entry_order INTEGER NOT NULL CHECK (entry_order >= 0),
    canonical_path TEXT NOT NULL,
    root_class TEXT NOT NULL CHECK (root_class IN ('project', 'user')),
    root_path TEXT NOT NULL,
    digest TEXT NOT NULL,
    metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
    has_name_collision INTEGER NOT NULL CHECK (has_name_collision IN (0, 1)),
    diagnostics_json TEXT NOT NULL CHECK (json_valid(diagnostics_json)),
    PRIMARY KEY (catalog_id, skill_id),
    UNIQUE (catalog_id, entry_order),
    UNIQUE (catalog_id, canonical_path)
  ) STRICT;

  CREATE TABLE skill_catalog_diagnostics (
    catalog_id TEXT NOT NULL,
    diagnostic_id TEXT NOT NULL,
    diagnostic_order INTEGER NOT NULL CHECK (diagnostic_order >= 0),
    diagnostic_json TEXT NOT NULL CHECK (json_valid(diagnostic_json)),
    PRIMARY KEY (catalog_id, diagnostic_id),
    UNIQUE (catalog_id, diagnostic_order)
  ) STRICT;

  CREATE TABLE skill_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    catalog_id TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    canonical_path TEXT NOT NULL,
    root_class TEXT NOT NULL CHECK (root_class IN ('project', 'user')),
    digest TEXT NOT NULL,
    metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
    content BLOB NOT NULL,
    stored_at INTEGER NOT NULL CHECK (stored_at >= 0),
    CHECK (length(content) > 0)
  ) STRICT;

  CREATE TRIGGER skill_snapshots_reject_update
    BEFORE UPDATE ON skill_snapshots
    BEGIN
      SELECT RAISE(ABORT, 'skill snapshots are immutable');
    END;

  CREATE TRIGGER skill_snapshots_reject_delete
    BEFORE DELETE ON skill_snapshots
    BEGIN
      SELECT RAISE(ABORT, 'skill snapshots are immutable');
    END;
`;

const CARD_WORKTREE_SCHEMA_SQL = `
  CREATE TABLE card_worktrees (
    card_id TEXT PRIMARY KEY REFERENCES cards(card_id) ON DELETE CASCADE,
    board_id TEXT NOT NULL REFERENCES boards(board_id) ON DELETE CASCADE,
    binding_version INTEGER NOT NULL CHECK (binding_version = 1),
    binding_id TEXT NOT NULL UNIQUE,
    repository_root TEXT NOT NULL,
    repository_git_dir TEXT NOT NULL,
    managed_root TEXT NOT NULL,
    worktree_path TEXT NOT NULL UNIQUE,
    branch TEXT NOT NULL,
    baseline_branch TEXT NOT NULL,
    baseline_commit TEXT NOT NULL,
    lifecycle TEXT NOT NULL CHECK (
      lifecycle IN ('active', 'unavailable', 'cleanup_refused', 'removed')
    ),
    reason TEXT CHECK (
      reason IS NULL OR reason IN (
        'not_git_repository', 'detached', 'gitlink', 'managed_root_invalid',
        'collision', 'missing', 'external', 'symlink', 'repository_mismatch',
        'branch_mismatch', 'baseline_mismatch', 'parent_changed', 'dirty',
        'divergent', 'unmerged', 'live', 'removed', 'unverified', 'git_failed'
      )
    ),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE (repository_git_dir, branch),
    CHECK (
      (lifecycle IN ('active', 'removed') AND reason IS NULL) OR
      (lifecycle IN ('unavailable', 'cleanup_refused') AND reason IS NOT NULL)
    )
  ) STRICT;
`;

const ATTEMPT_ADMISSION_SCHEMA_SQL = `
  CREATE TABLE attempts (
    attempt_id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(board_id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(card_id) ON DELETE CASCADE,
    generation INTEGER NOT NULL CHECK (generation >= 0),
    state TEXT NOT NULL CHECK (
      state IN ('created', 'starting', 'running', 'needs_attention', 'succeeded', 'failed', 'cancelled', 'interrupted')
    ),
    session_id TEXT,
    failure_json TEXT CHECK (failure_json IS NULL OR json_valid(failure_json)),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    started_at INTEGER CHECK (started_at IS NULL OR started_at >= created_at),
    terminal_at INTEGER CHECK (terminal_at IS NULL OR terminal_at >= created_at),
    UNIQUE (card_id, generation),
    CHECK (state <> 'running' OR session_id IS NOT NULL),
    CHECK (state <> 'failed' OR failure_json IS NOT NULL)
  ) STRICT;

  CREATE UNIQUE INDEX attempts_one_live_per_card
    ON attempts(card_id)
    WHERE state IN ('created', 'starting', 'running', 'needs_attention');

  CREATE TABLE run_contexts (
    attempt_id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation >= 0),
    context_json TEXT NOT NULL CHECK (json_valid(context_json)),
    UNIQUE (card_id, generation)
  ) STRICT;

  CREATE TRIGGER run_contexts_reject_update
    BEFORE UPDATE ON run_contexts
    BEGIN
      SELECT RAISE(ABORT, 'Run Contexts are immutable');
    END;

  CREATE TRIGGER run_contexts_reject_delete
    BEFORE DELETE ON run_contexts
    BEGIN
      SELECT RAISE(ABORT, 'Run Contexts are immutable');
    END;
`;

export const DESKTOP_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    name: "initial_desktop_journal_and_projections",
    up(database) {
      database.run(INITIAL_SCHEMA_SQL);
    },
  },
  {
    version: 2,
    name: "skill_catalog_projections_and_snapshots",
    up(database) {
      database.run(SKILL_CATALOG_SCHEMA_SQL);
    },
  },
  {
    version: 3,
    name: "card_owned_worktree_bindings",
    up(database) {
      database.run(CARD_WORKTREE_SCHEMA_SQL);
    },
  },
  {
    version: 4,
    name: "attempt_admission_and_immutable_run_contexts",
    up(database) {
      database.run(ATTEMPT_ADMISSION_SCHEMA_SQL);
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
