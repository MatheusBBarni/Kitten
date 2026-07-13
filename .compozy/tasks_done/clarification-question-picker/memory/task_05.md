# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Replace the permission-only controller queue with an opaque permission/clarification coordinator while preserving existing approval behavior.

## Important Decisions

- The coordinator exposes only resolver-free active projections and guarded lifecycle operations; queued, suspended, active, and terminal entries plus resolvers remain internal.
- Clarifications preempt immediately and suspended interactions resume deterministically before ordinary FIFO advancement.
- Connection generations are monotonic per Kitten SessionId and are cancelled at error, replacement, restore, close, failure, and disposal boundaries.
- Task 06 still owns adapter clarification callback binding plus actions/store projection; Task 05 provides the coordinator seam without pulling that work forward.

## Learnings

- Full-run restore replaces the fleet, while start-new-run and start-fresh replace runtimes individually; both paths must cancel the old generation before disposal.
- The existing adapter reports an unexpected disconnect as a protocol-free `status: error`, which is the current controller seam for terminal interaction cleanup.

## Files / Surfaces

- `src/app/controller.ts`: discriminated coordinator, active projection, generation capture, and lifecycle cleanup.
- `src/app/controller.test.ts`: FIFO, preemption/resumption, stale settlement, cleanup, restore, disconnect, and sibling-usability coverage.

## Errors / Corrections

- Red baseline: the focused controller suite failed because `createInteractionCoordinator` did not exist.
- A focused coverage invocation exited non-zero because Bun applied the repository threshold to low-coverage transitive imports; the required repository-wide coverage run passed with 97.31% functions and 98.30% lines overall, including 93.75% functions and 98.92% lines for `controller.ts`.
- Fresh final verification passed after the last code change: typecheck, 1,452 passing tests with 2 credential-dependent skips and 0 failures, `SELF-CHECK OK`, and the compiled build.

## Ready for Next Run

- Task 05 is complete and verified. Task 06 can bind adapter clarification callbacks and project public clarification actions/state through the coordinator seam.
