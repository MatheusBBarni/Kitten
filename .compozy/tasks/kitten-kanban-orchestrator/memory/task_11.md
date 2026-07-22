# Task Memory: task_11.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implement the desktop attempt-admission boundary: deterministic runnable validation, default-one global scheduling, immutable Run Context capture, journal-first attempt creation, and one fresh certified Direct ACP session per generation.
- Required evidence covers actionable validation failures, leak-free capacity, immutable snapshots, context-before-session ordering, distinct fresh sessions, and isolated persisted startup failure.
- Explicit exclusions: no `loadSession`, live recovery claim, workflow advancement, automatic publication, follow-up queue, or Attention Blocker behavior.

## Important Decisions

- The desktop coordinator owns admission and lifecycle ordering: reserve only after fresh worktree verification, commit card/attempt/Run Context atomically, and invoke Direct ACP only after that commit succeeds.
- The Direct ACP attempt boundary is intentionally fresh-only: its public connection contract exposes `newSession` and `close`, with no `loadSession` capability.
- Run Context rows are immutable SQLite evidence retained across disposable projection rebuilds; replay revalidates the exact serialized context rather than rewriting it.
- Startup failure is persisted as a failed attempt and failed card status, then the exact scheduler reservation is released in `finally`; it does not create queue or Attention Blocker state.

## Learnings

- The engine already supplied the protocol-free attempt generation, attempt id, readiness, and state contracts. Desktop imports them type-only so attempt tests do not pull the full engine runtime into the package coverage boundary.
- Desktop coverage is enforced per file as well as globally; validation branches must not introduce unexecuted helper closures that lower function coverage below 80%.

## Files / Surfaces

- Added `packages/desktop/src/attempts/` contracts, validator, scheduler, coordinator, fresh ACP adapter, exports, and fake-ACP/unit evidence.
- Extended `packages/desktop/src/persistence/eventJournal.ts`, `migrations.ts`, `projectionRebuilder.ts`, and persistence tests for journaled attempts and immutable Run Context evidence.
- Added the desktop package's type-only `@kitten/engine` workspace dependency and adjusted the exact-pin boundary test to distinguish internal workspace dependencies.

## Errors / Corrections

- The first targeted test command correctly failed because Task 11 test files did not yet exist; it established the red baseline.
- Adding the internal engine dependency required refreshing `bun.lock`; external desktop dependencies remain exact-pinned.
- The first coverage run passed all tests but failed the per-file function floor in `contracts.ts`; replacing inline throwing closures with direct validation brought the file to 100% functions.

## Ready for Next Run

- Task 11 implementation and self-review are complete. Fresh evidence: desktop typecheck passed; desktop coverage ran 56 tests with 0 failures at 97.43% functions / 94.87% lines; repository typechecks passed and the full suite ran 3,184 passing, 5 credential-gated skips, 0 failures.
- Later attempt lifecycle consumers must persist a durable terminal transition before calling coordinator `release`; restart reconciliation and interrupted-attempt recovery remain Task 18 scope.
