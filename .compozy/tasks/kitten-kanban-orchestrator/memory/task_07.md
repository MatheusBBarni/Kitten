# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Build the desktop-host-only SQLite authority for migrations, immutable journal events, atomic board/stage/edge/card projections, snapshots, and deterministic rebuild.
- Completion requires temporary-file reopen/rebuild integration evidence, at least 80% desktop coverage, and the repository typecheck/test gate.

## Important Decisions

- Keep the initial schema limited to boards, workflow stages, workflow edges, cards, journal events, schema versions, and projection metadata; attempt recovery remains Task 18 scope.
- Projection writes are derived from validated journal event kinds and commit in the same SQLite transaction as the event. Projection deltas are observable only after that transaction returns successfully.
- Use Bun's built-in `bun:sqlite` API inside `packages/desktop/src/persistence`; the renderer receives projections only through the existing RPC boundary.
- Use the same strict kind-specific projection reducer for live appends and rebuilds. SQLite triggers reject journal row updates/deletes, while unique indexes backstop event and attempt-sequence identity.

## Learnings

- Pre-change desktop tests pass 8/8, while `packages/desktop/src/persistence` does not exist, providing the baseline signal for this task.
- Bun 1.3.13 is installed; current Bun documentation confirms `Database.transaction()` rolls back thrown errors and statement `run()` reports `changes` and `lastInsertRowid`.
- The desktop package originally tested only `test/`; its scripts now include both `src` and `test` so colocated persistence tests participate in normal and coverage gates.
- A read-only second connection can observe the projection immediately after `append()` returns, supplying direct evidence that the returned delta is post-commit.
- Final desktop coverage is 96.19% functions and 98.27% lines with 19 passing tests. The full repository suite passes 3,147 tests with 0 failures and 5 credentialed skips.

## Files / Surfaces

- `packages/desktop/src/persistence/sqliteDatabase.ts`
- `packages/desktop/src/persistence/migrations.ts`
- `packages/desktop/src/persistence/eventJournal.ts`
- `packages/desktop/src/persistence/projectionRebuilder.ts`
- `packages/desktop/src/persistence/eventJournal.test.ts`
- `packages/desktop/package.json`
- `packages/desktop/test/desktopShell.test.ts`

## Files / Surfaces

## Errors / Corrections

- The worktree already contains user-owned task tracking and workflow-memory changes from Tasks 01-06; preserve them and stage Task 07 files narrowly.

## Ready for Next Run

- Task 07 is implemented and verified. Downstream Tasks 08 and 09 can consume the journal contracts and projection snapshot/rebuild surfaces.
- Implementation commit: `b5a7efe` (`feat: add immutable SQLite journal and projection rebuild`). Task tracking and workflow memory remain outside the automatic commit.
- Re-run desktop coverage and the full repository typecheck/test gate after any persistence change.
