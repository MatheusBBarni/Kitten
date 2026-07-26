# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implement one durable `submitCardPrompt` path for initial and composer prompts,
  with persisted FIFO admission, safe-boundary dispatch, restart-safe
  idempotency, and fail-closed interrupted delivery.

## Important Decisions

- Keep `source: "request_changes"` fail-closed in Task 07; Task 09 owns the
  evidence-bound lifecycle transition.
- Treat the existing broad uncommitted task-wave diff as user-owned and preserve
  it; Task 07 edits and verification must stay narrow to its named surfaces.
- Persist a content-free submission record and its projection changes in one
  `prompt_submission_committed` journal event. A SHA-256-derived event identity
  makes `commandId` replay durable without putting submitted text in outcomes.
- Preserve the submitted initial prompt bytes after using `trim()` only to test
  whether content is empty.

## Learnings

- The host prompt promise is the safe ACP boundary already owned by
  `dispatchAcceptedDirections`: persist `dispatching`, await one prompt, then
  persist `dispatched` or `interrupted` before considering the next FIFO head.
- Queue persistence must precede both the success envelope and the derived
  inspector activity. The queue remains the authoritative durable admission
  record if activity ingestion is delayed.
- A reopened coordinator can return the original admitted/queued result from
  the journal without opening ACP or appending another queue row.
- Task-local coverage is above the 80% floor:
  `attemptCoordinator.ts` 89.99% lines, `desktopRpc.ts` 82.07%,
  `eventJournal.ts` 99.49%, and `shared/rpc.ts` 100%.

## Files / Surfaces

- Coordinator and queue lifecycle:
  `packages/desktop/src/attempts/attemptCoordinator.ts`,
  `packages/desktop/src/attempts/followUpQueue.ts`, and their tests.
- Durable submission journal:
  `packages/desktop/src/persistence/eventJournal.ts`.
- Typed host boundary:
  `packages/desktop/src/shared/rpc.ts`,
  `packages/desktop/src/host/desktopRpc.ts`,
  `packages/desktop/src/host/electrobunWindow.ts`, and
  `packages/desktop/src/main.ts`.
- Renderer call sites:
  `packages/desktop/src/renderer/client.ts`,
  `packages/desktop/src/renderer/main.tsx`,
  `packages/desktop/src/renderer/features/inspector/useInspectorCommands.ts`,
  and `packages/desktop/src/renderer/features/board/useTaskRunControls.ts`.
- Restart/RPC/ACP coverage:
  `packages/desktop/test/followUpQueue.integration.test.ts`,
  `packages/desktop/test/desktopSmoke.integration.test.ts`,
  `packages/desktop/test/recoveryReview.integration.test.ts`, and
  `packages/desktop/test/desktopShell.test.ts`.

## Errors / Corrections

- Initial FIFO tests observed the ACP call before the dispatched journal append;
  assertions now wait for durable queue state rather than prompt-array timing.
- The first coverage pass exposed `desktopRpc.ts` at 79.89% lines; missing-card
  and inactive-attempt RPC tests raised it to 82.07%.
- `bun run test:coverage` still exits 1 despite 263/263 tests passing and 92.95%
  aggregate line coverage. Inherited per-file deficits remain in unrelated wave
  surfaces including `workflowApiServer.ts`, `main.ts`, and renderer board/view
  files. Do not broaden Task 07 to repair those files.
- The fresh authoritative `bun run verify` closeout run reaches the same
  coverage-only failure after typecheck and every acceptance partition pass.

## Ready for Next Run

- Implementation, focused tests, the full suite, typecheck, acceptance, and
  build are clean.
- Task tracking and automatic commit remain blocked unless the authoritative
  `bun run verify` gate becomes clean; preserve the current implementation and
  the pre-existing dirty task wave.
