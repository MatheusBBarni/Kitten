import type { Database } from "bun:sqlite";
import {
  parseFollowUpQueueProjection,
  serializeFollowUpQueueProjection,
} from "../attempts/followUpQueue.ts";

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

const ATTEMPT_INSPECTOR_SCHEMA_SQL = `
  CREATE TABLE attempt_inspector_projections (
    attempt_id TEXT PRIMARY KEY REFERENCES attempts(attempt_id) ON DELETE CASCADE,
    board_id TEXT NOT NULL REFERENCES boards(board_id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(card_id) ON DELETE CASCADE,
    generation INTEGER NOT NULL CHECK (generation >= 0),
    next_sequence INTEGER NOT NULL CHECK (next_sequence >= 2),
    terminal_outcome TEXT CHECK (
      terminal_outcome IS NULL OR
      terminal_outcome IN ('succeeded', 'failed', 'cancelled', 'interrupted')
    ),
    projection_json TEXT NOT NULL CHECK (json_valid(projection_json)),
    updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
    UNIQUE (card_id, generation)
  ) STRICT;

  CREATE INDEX attempt_inspector_card_generation
    ON attempt_inspector_projections(card_id, generation);
`;

const FOLLOW_UP_QUEUE_SCHEMA_SQL = `
  CREATE TABLE follow_up_queue_projections (
    attempt_id TEXT PRIMARY KEY REFERENCES attempts(attempt_id) ON DELETE CASCADE,
    board_id TEXT NOT NULL REFERENCES boards(board_id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(card_id) ON DELETE CASCADE,
    generation INTEGER NOT NULL CHECK (generation >= 0),
    version INTEGER NOT NULL CHECK (version > 0),
    projection_json TEXT NOT NULL CHECK (json_valid(projection_json)),
    updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
    UNIQUE (card_id, generation)
  ) STRICT;

  CREATE INDEX follow_up_queue_card_generation
    ON follow_up_queue_projections(card_id, generation);
`;

const ATTENTION_BLOCKER_SCHEMA_SQL = `
  CREATE TABLE attention_blocker_projections (
    blocker_id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id) ON DELETE CASCADE,
    board_id TEXT NOT NULL REFERENCES boards(board_id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(card_id) ON DELETE CASCADE,
    call_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation >= 0),
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    projection_json TEXT NOT NULL CHECK (json_valid(projection_json)),
    notification_state TEXT NOT NULL CHECK (notification_state IN ('pending', 'delivered', 'failed')),
    version INTEGER NOT NULL CHECK (version > 0),
    UNIQUE (attempt_id, call_id),
    UNIQUE (card_id, generation, blocker_id)
  ) STRICT;

  CREATE UNIQUE INDEX attention_one_active_per_attempt
    ON attention_blocker_projections(attempt_id)
    WHERE active = 1;

  CREATE INDEX attention_card_generation
    ON attention_blocker_projections(card_id, generation, blocker_id);
`;

const RECOVERY_REVIEW_SCHEMA_SQL = `
  CREATE TABLE review_dispositions (
    review_id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(board_id) ON DELETE CASCADE,
    card_id TEXT NOT NULL UNIQUE REFERENCES cards(card_id) ON DELETE CASCADE,
    disposition TEXT NOT NULL CHECK (disposition = 'approved'),
    reviewer TEXT NOT NULL CHECK (reviewer = 'operator'),
    reviewed_card_version INTEGER NOT NULL CHECK (reviewed_card_version > 0),
    occurred_at INTEGER NOT NULL CHECK (occurred_at >= 0)
  ) STRICT;
`;

const IMMUTABLE_REVIEW_EVIDENCE_SCHEMA_SQL = `
  CREATE TABLE review_evidence (
    evidence_id TEXT PRIMARY KEY CHECK (length(trim(evidence_id)) > 0),
    board_id TEXT NOT NULL CHECK (length(trim(board_id)) > 0),
    card_id TEXT NOT NULL CHECK (length(trim(card_id)) > 0),
    attempt_id TEXT NOT NULL CHECK (length(trim(attempt_id)) > 0),
    generation INTEGER NOT NULL CHECK (generation >= 0),
    worktree_binding_id TEXT NOT NULL CHECK (length(trim(worktree_binding_id)) > 0),
    base_commit TEXT NOT NULL CHECK (length(trim(base_commit)) > 0),
    head_commit TEXT NOT NULL CHECK (length(trim(head_commit)) > 0),
    policy_version INTEGER NOT NULL CHECK (policy_version > 0),
    evidence_digest TEXT NOT NULL CHECK (length(trim(evidence_digest)) > 0),
    file_count INTEGER NOT NULL CHECK (file_count >= 0),
    patch_bytes INTEGER NOT NULL CHECK (patch_bytes >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    UNIQUE (evidence_digest),
    UNIQUE (
      evidence_id, card_id, attempt_id, generation, evidence_digest,
      worktree_binding_id
    ),
    UNIQUE (card_id, attempt_id, generation, evidence_digest),
    CHECK (file_count > 0 OR patch_bytes = 0)
  ) STRICT;

  CREATE TABLE review_evidence_files (
    evidence_id TEXT NOT NULL,
    file_index INTEGER NOT NULL CHECK (file_index >= 0),
    file_id TEXT NOT NULL CHECK (length(trim(file_id)) > 0),
    status TEXT NOT NULL CHECK (
      status IN ('added', 'modified', 'deleted', 'renamed', 'copied', 'binary')
    ),
    old_path TEXT CHECK (old_path IS NULL OR length(trim(old_path)) > 0),
    new_path TEXT CHECK (new_path IS NULL OR length(trim(new_path)) > 0),
    old_mode TEXT CHECK (old_mode IS NULL OR length(trim(old_mode)) > 0),
    new_mode TEXT CHECK (new_mode IS NULL OR length(trim(new_mode)) > 0),
    is_binary INTEGER NOT NULL CHECK (is_binary IN (0, 1)),
    additions INTEGER CHECK (additions IS NULL OR additions >= 0),
    deletions INTEGER CHECK (deletions IS NULL OR deletions >= 0),
    patch_size INTEGER NOT NULL CHECK (patch_size >= 0),
    patch_digest TEXT NOT NULL CHECK (length(trim(patch_digest)) > 0),
    content_digest TEXT CHECK (
      content_digest IS NULL OR length(trim(content_digest)) > 0
    ),
    patch_blob BLOB,
    PRIMARY KEY (evidence_id, file_index),
    UNIQUE (evidence_id, file_id),
    FOREIGN KEY (evidence_id) REFERENCES review_evidence(evidence_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK (old_path IS NOT NULL OR new_path IS NOT NULL),
    CHECK (
      (is_binary = 1 AND status = 'binary' AND patch_blob IS NULL AND patch_size = 0) OR
      (is_binary = 0 AND status <> 'binary' AND patch_blob IS NOT NULL)
    ),
    CHECK (patch_blob IS NULL OR length(patch_blob) = patch_size)
  ) STRICT;

  CREATE INDEX review_evidence_latest_card
    ON review_evidence(card_id, created_at DESC, evidence_id DESC);

  CREATE INDEX review_evidence_attempt_generation
    ON review_evidence(attempt_id, generation, created_at, evidence_id);

  CREATE TRIGGER review_evidence_reject_update
    BEFORE UPDATE ON review_evidence
    BEGIN
      SELECT RAISE(ABORT, 'review evidence is immutable');
    END;

  CREATE TRIGGER review_evidence_reject_delete
    BEFORE DELETE ON review_evidence
    BEGIN
      SELECT RAISE(ABORT, 'review evidence is immutable');
    END;

  CREATE TRIGGER review_evidence_files_reject_update
    BEFORE UPDATE ON review_evidence_files
    BEGIN
      SELECT RAISE(ABORT, 'review evidence files are immutable');
    END;

  CREATE TRIGGER review_evidence_files_reject_delete
    BEFORE DELETE ON review_evidence_files
    BEGIN
      SELECT RAISE(ABORT, 'review evidence files are immutable');
    END;

  CREATE TRIGGER review_evidence_files_validate_totals
    AFTER INSERT ON review_evidence_files
    BEGIN
      SELECT CASE
        WHEN NEW.file_index >= (
          SELECT file_count FROM review_evidence
          WHERE evidence_id = NEW.evidence_id
        )
        THEN RAISE(ABORT, 'review evidence file index exceeds manifest count')
      END;
      SELECT CASE
        WHEN (
          SELECT count(*) FROM review_evidence_files
          WHERE evidence_id = NEW.evidence_id
        ) > (
          SELECT file_count FROM review_evidence
          WHERE evidence_id = NEW.evidence_id
        )
        THEN RAISE(ABORT, 'review evidence file count exceeds manifest count')
      END;
      SELECT CASE
        WHEN (
          SELECT coalesce(sum(patch_size), 0) FROM review_evidence_files
          WHERE evidence_id = NEW.evidence_id
        ) > (
          SELECT patch_bytes FROM review_evidence
          WHERE evidence_id = NEW.evidence_id
        )
        THEN RAISE(ABORT, 'review evidence patch bytes exceed manifest total')
      END;
      SELECT CASE
        WHEN (
          SELECT count(*) FROM review_evidence_files
          WHERE evidence_id = NEW.evidence_id
        ) = (
          SELECT file_count FROM review_evidence
          WHERE evidence_id = NEW.evidence_id
        )
        AND (
          SELECT coalesce(sum(patch_size), 0) FROM review_evidence_files
          WHERE evidence_id = NEW.evidence_id
        ) <> (
          SELECT patch_bytes FROM review_evidence
          WHERE evidence_id = NEW.evidence_id
        )
        THEN RAISE(ABORT, 'review evidence patch bytes do not match manifest total')
      END;
    END;

  ALTER TABLE review_dispositions RENAME TO review_dispositions_v8;

  CREATE TABLE review_dispositions (
    review_id TEXT PRIMARY KEY CHECK (length(trim(review_id)) > 0),
    board_id TEXT NOT NULL CHECK (length(trim(board_id)) > 0),
    card_id TEXT NOT NULL CHECK (length(trim(card_id)) > 0),
    evidence_id TEXT,
    evidence_digest TEXT,
    attempt_id TEXT,
    generation INTEGER CHECK (generation IS NULL OR generation >= 0),
    worktree_binding_id TEXT,
    disposition TEXT NOT NULL CHECK (
      disposition IN ('approved', 'changes_requested')
    ),
    reviewer TEXT NOT NULL CHECK (reviewer = 'operator'),
    reviewed_card_version INTEGER NOT NULL CHECK (reviewed_card_version > 0),
    occurred_at INTEGER NOT NULL CHECK (occurred_at >= 0),
    FOREIGN KEY (
      evidence_id, card_id, attempt_id, generation, evidence_digest,
      worktree_binding_id
    ) REFERENCES review_evidence(
      evidence_id, card_id, attempt_id, generation, evidence_digest,
      worktree_binding_id
    ) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK (
      (
        evidence_id IS NULL AND evidence_digest IS NULL AND attempt_id IS NULL
        AND generation IS NULL AND worktree_binding_id IS NULL
      ) OR (
        evidence_id IS NOT NULL AND evidence_digest IS NOT NULL
        AND attempt_id IS NOT NULL AND generation IS NOT NULL
        AND worktree_binding_id IS NOT NULL
      )
    )
  ) STRICT;

  INSERT INTO review_dispositions(
    review_id, board_id, card_id, disposition, reviewer,
    reviewed_card_version, occurred_at
  )
  SELECT
    review_id, board_id, card_id, disposition, reviewer,
    reviewed_card_version, occurred_at
  FROM review_dispositions_v8;

  DROP TABLE review_dispositions_v8;

  CREATE INDEX review_dispositions_card_rounds
    ON review_dispositions(card_id, occurred_at, review_id);

  CREATE UNIQUE INDEX review_dispositions_one_per_evidence
    ON review_dispositions(evidence_id)
    WHERE evidence_id IS NOT NULL;

  CREATE TRIGGER review_dispositions_require_evidence
    BEFORE INSERT ON review_dispositions
    WHEN NEW.evidence_id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'review dispositions require evidence');
    END;

  CREATE TRIGGER review_dispositions_reject_update
    BEFORE UPDATE ON review_dispositions
    BEGIN
      SELECT RAISE(ABORT, 'review dispositions are immutable');
    END;

  CREATE TRIGGER review_dispositions_reject_delete
    BEFORE DELETE ON review_dispositions
    BEGIN
      SELECT RAISE(ABORT, 'review dispositions are immutable');
    END;
`;

function migrateFollowUpQueueRows(database: Database): void {
  const rows = database.query<{
    readonly attemptId: string;
    readonly projectionJson: string;
  }, []>(`
    SELECT attempt_id AS attemptId, projection_json AS projectionJson
    FROM follow_up_queue_projections ORDER BY attempt_id
  `).all();
  const update = database.query<void, [string, string]>(`
    UPDATE follow_up_queue_projections
    SET projection_json = ?
    WHERE attempt_id = ?
  `);
  try {
    for (const row of rows) {
      update.run(
        serializeFollowUpQueueProjection(parseFollowUpQueueProjection(row.projectionJson)),
        row.attemptId,
      );
    }
  } finally {
    update.finalize();
  }
}

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
  {
    version: 5,
    name: "normalized_activity_and_inspector_projections",
    up(database) {
      database.run(ATTEMPT_INSPECTOR_SCHEMA_SQL);
    },
  },
  {
    version: 6,
    name: "durable_confirmable_follow_up_queue",
    up(database) {
      database.run(FOLLOW_UP_QUEUE_SCHEMA_SQL);
    },
  },
  {
    version: 7,
    name: "durable_attention_blockers_and_notification_results",
    up(database) {
      database.run(ATTENTION_BLOCKER_SCHEMA_SQL);
    },
  },
  {
    version: 8,
    name: "interrupted_attempt_recovery_and_review_dispositions",
    up(database) {
      database.run(RECOVERY_REVIEW_SCHEMA_SQL);
    },
  },
  {
    version: 9,
    name: "immutable_review_evidence_and_queue_v2",
    up(database) {
      database.run(IMMUTABLE_REVIEW_EVIDENCE_SCHEMA_SQL);
      migrateFollowUpQueueRows(database);
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
