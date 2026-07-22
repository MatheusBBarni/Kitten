# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implement the protocol-free desktop workflow domain and durable command boundary for boards, stages, linear edges, and cards, including typed conflicts, idempotency, stage locks, immediate-successor progression, replay, and required coverage.

## Important Decisions

- Preserve the Task 07 journal as the transactional authority and extend its event model only where a single accepted command must update multiple projections atomically.
- Represent each accepted mutation as one `workflow_command_committed` event containing its stable command fingerprint and ordered projection changes; exact retries are idempotent, while identity reuse for a different command is rejected.
- Treat `connect_stages` as replacement of the complete edge set and make `reorder_stages` deterministically rebuild immediate-successor edges from the requested total order.
- Keep execution-status mutation system-owned and exclude `ready_for_review` and `completed`; only successful agent progression can produce `ready_for_review` in this task.

## Learnings

- Pre-change evidence: Task 07 persistence tests pass (10 tests), while `packages/desktop/src/workflow` has no tracked files, so Task 08 behavior is absent rather than regressed.
- A journal append needs board/card version preconditions checked inside the same SQLite transaction as event insertion and projection application; snapshot-only checks would leave a stale-write race.
- Task-focused coverage after implementation is 98.89% functions / 97.45% lines overall; `workflowCommands.ts` is 94.87% functions / 90.55% lines.

## Files / Surfaces

- Added `packages/desktop/src/workflow/workflowTypes.ts`, `workflowValidation.ts`, and `workflowCommands.ts` with colocated unit and temporary-SQLite integration tests.
- Extended `packages/desktop/src/persistence/eventJournal.ts` for branded projections, multi-change command events, edge deletions, transactional version preconditions, and event lookup; updated its fixtures in `eventJournal.test.ts`.

## Errors / Corrections

- Initial desktop typecheck exposed old persistence fixtures assigning raw strings to the new opaque IDs; corrected the fixtures to use `workflowIds` and narrowed their generic event helper to legacy single-projection events.

## Ready for Next Run

- Implementation and self-review are complete. Targeted workflow/persistence tests pass (21/21), desktop tests and coverage pass (30/30), and the repository gate passes with 3,158 tests, 5 credential-gated skips, and 0 failures.
- No shared-memory promotion is needed: the durable command/replay contract is explicit in the source and task specification.
