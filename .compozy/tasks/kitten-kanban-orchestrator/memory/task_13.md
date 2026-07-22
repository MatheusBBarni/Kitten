# Task Memory: task_13.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add a desktop-owned durable FIFO follow-up queue whose active-turn submissions never cancel or auto-send, and whose settled head requires explicit fenced confirmation before one same-attempt prompt dispatch.

## Important Decisions

- Model prompt-turn settlement separately from attempt terminal state. `DirectAcpPromptResult` already carries turn stop reasons, while `AttemptProjection.state` remains the authoritative attempt lifecycle fence.
- Persist every queue transition as its own immutable journal event and keep a disposable queue projection for current reads/rebuild equality.
- Commit confirmation evidence before invoking the external prompt boundary; ordinary queue operations never receive or call a cancellation capability.

## Learnings

- Task 12 has durable attempt/activity/inspector projections but no queue event, table, RPC operation, or prompt-dispatch method yet.
- The existing activity journal sequence is ACP-activity-specific, so queue evidence must not consume that sequence or create artificial gaps in normalized activity replay.
- The desktop coverage gate is per-file as well as aggregate; new shell handler branches needed direct forwarding/fallback coverage before `test:coverage` became clean.

## Files / Surfaces

- Added the queue domain and unit tests in `packages/desktop/src/attempts/followUpQueue.ts` and `followUpQueue.test.ts`.
- Extended the attempt coordinator and Direct ACP connection contract for same-session prompt dispatch, typed fences, blocker gating, and content-free telemetry.
- Added migration 6, immutable queue journal events, queue projections, snapshot reads, and deterministic rebuild support.
- Added typed Electrobun queue/remove/confirm requests through `src/host/desktopRpc.ts`, the shared schema, shell registration, and handler tests.
- Added temporary-SQLite/fake-ACP integration coverage in `packages/desktop/test/followUpQueue.integration.test.ts`.

## Errors / Corrections

- Updated the migration contract test from schema version 5 to 6 after the full desktop suite exposed the expected mismatch.
- Added direct shell RPC handler coverage after the first coverage run left `src/main.ts` below the per-file 80% gate.
- Tightened confirmation so projected `needs_attention` blocks dispatch even when the future attention-service callback is absent.

## Ready for Next Run

- Implementation, tracking, self-review, targeted tests, desktop coverage, and repository-wide typecheck/tests are clean. The task is ready for its narrow local commit.
