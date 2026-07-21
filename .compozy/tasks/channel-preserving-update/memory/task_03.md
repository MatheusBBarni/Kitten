# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implement the fail-closed standalone update transaction in `src/update.ts`, with unit and isolated filesystem/release integration evidence.
- Keep Task 03 scoped away from public CLI dispatch, the installer, Node launcher, release workflow, and documentation.

## Important Decisions

- Treat ownership validation as a pre-network, pre-mutation gate; every inconclusive condition refuses without channel fallback.
- Require fixed GitHub latest-release and tag-scoped asset URLs, exact manifest matching, candidate hash verification, and a recoverable same-directory transaction.
- Revalidate exact executable and registry snapshots after acquiring the lock; retain private recovery artifacts when rollback evidence is inconclusive.

## Learnings

- Temporary paths on macOS may resolve through `/private`; failure injection and registry ownership assertions must use the canonical path, not the pre-`realpath` spelling.
- Focused coverage measured `src/update.ts` at 90.59% functions and 94.33% lines; the full repository coverage gate also exited successfully.

## Files / Surfaces

- `src/update.ts`: standalone ownership, release retrieval, candidate verification, lock/transaction, rollback, and production effect seams.
- `src/update.test.ts`: pre-network refusal, no-write, success, failure-matrix, cleanup, and rollback coverage.
- `test/update.integration.test.ts`: local release responses with real target/registry bytes and induced publication failures.

## Errors / Corrections

- Rollback cleanup initially risked deleting backup/snapshot evidence after an inconclusive restore; cleanup now preserves those recovery artifacts when rollback cannot be proved.

## Ready for Next Run

- Task 03 is implemented and self-reviewed against all six requirements.
- Fresh verification passed: focused 54-test suite, full coverage gate, repository typecheck/test gate, `SELF-CHECK OK`, and host `build:local` with `SHA256SUMS` output.
- Implementation and tests were committed locally as `c45e17d` (`feat(update): execute fail-closed standalone updates`); tracking and workflow-memory files remain outside the commit as required.
- Task 04 can consume the exported `runStandaloneUpdate` outcome without changing this transaction boundary.
