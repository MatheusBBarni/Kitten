# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Replace the confirmation-era durable follow-up projection with schema-v2 FIFO
  queue states and fail-closed startup recovery, with focused unit and
  persistence integration coverage.

## Important Decisions

- Keep Task 02 at the durable queue/recovery boundary. Task 07 still owns the
  unified public submission RPC and ACP safe-boundary coordinator replacement.
- Treat the durable draft order as authoritative. An `interrupted` FIFO head
  blocks later queued items until the user explicitly removes or retries it.
- Preserve the existing queue identity as the durable idempotency identity
  across parsing, replay, and explicit retry.
- Task 03 owns the append-only migration-v9 DDL. Task 02 will make legacy
  schema-v1 queue JSON deterministically parse/rebuild as schema v2 so Task 03
  can persist that model without rewriting historical migrations.

## Learnings

- Task 01 contract changes are present but uncommitted in `shared/rpc.ts` and
  desktop shell tests; they must be preserved and excluded from this task's
  commit.
- Queue-v2 now parses historical schema-v1 projections and immutable queue
  events into the new vocabulary without changing attempt identity, generation,
  queue identity, durable order, or queue version.
- Startup recovery now atomically changes an unresolved `dispatching` FIFO head
  to `interrupted`, including queues whose attempt is already terminal, and
  never promotes or sends that item.
- The repository coverage command executes all tests successfully but enforces
  80% per file. Task-owned `followUpQueue.ts` is 95.65% function / 100% line
  covered; the command still exits 1 on inherited host and renderer files.

## Files / Surfaces

- Queue domain and compatibility coordination:
  `packages/desktop/src/attempts/followUpQueue.ts`,
  `packages/desktop/src/attempts/followUpQueue.test.ts`,
  `packages/desktop/src/attempts/attemptCoordinator.ts`, and
  `packages/desktop/src/attempts/attemptCoordinator.test.ts`.
- Durable journal and recovery:
  `packages/desktop/src/persistence/eventJournal.ts`,
  `packages/desktop/src/host/recovery.ts`, and
  `packages/desktop/src/host/recovery.test.ts`.
- Integration and fixture compatibility:
  `packages/desktop/test/followUpQueue.integration.test.ts`,
  `packages/desktop/test/recoveryReview.integration.test.ts`,
  `packages/desktop/test/desktopSmoke.integration.test.ts`, and
  `packages/desktop/src/renderer/features/inspector/testSupport.ts`.

## Errors / Corrections

- `bun --cwd packages/desktop ...` is unsupported by the installed Bun build;
  execute package scripts from `packages/desktop`.
- `bun run verify` passes typecheck and every acceptance group, then exits 1
  after 221/221 coverage tests pass because unrelated files remain below the
  repository's per-file 80% threshold. Per final-verification policy, do not
  mark the task complete or create the automatic commit.

## Ready for Next Run

- Resume with the current implementation intact. Re-run `bun run verify` after
  the inherited per-file coverage gate is repaired or explicitly waived.
- If the full gate is clean, repeat self-review, update Task 02 tracking, and
  create the requested local commit while excluding the pre-existing Task 01
  changes in `task_01.md`, `shared/rpc.ts`, and `desktopShell.test.ts`.
