# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the controller-owned Hard Stop coordinator and narrow action seams that preserve one queued ordinary continuation until cancellation acceptance plus captured-lifecycle settlement are proven.

## Important Decisions

- Keep proof evaluation live even when no continuation has been queued yet, so a draft submitted after cancellation settles can still be classified without issuing another cancel.
- Re-enter `preparePromptDispatch()` directly for the admitted continuation and use the reducer's deliver event to record the ordinary user turn exactly once; do not reuse steering or create a second harness path.
- Treat second Escape as local withdrawal of the exact queued request while allowing the already-requested Hard Stop proof to finish classifying the interrupted harness.
- Fence coordinator work by runtime object, ACP session id, generation, captured prompt lifecycle, request id, and a freshly re-read protocol-free capability verdict.

## Learnings

- The current generic `actions.cancel()` terminalizes the harness before `connection.cancel()`; the eligible Hard Stop path must bypass that ordering.
- `finishPromptLifecycle()` settles the captured promise and removes it from `activePrompts`, so a valid post-settlement identity check must allow the captured lifecycle to be absent while rejecting any replacement lifecycle.
- `preparePromptDispatch()` must reserve the session while the continuation coordinator owns it and admit only the exact reducer-owned request in `dispatching`; otherwise a competing ordinary send can enter between terminal settlement and the continuation dispatch.
- Task-local coverage is above the requested floor: `src/app/postInterruptContinuationCoordinator.ts` is 95.24% functions / 93.91% lines in the full isolated run.

## Files / Surfaces

- Implemented: `src/app/actions.ts`, `src/app/controller.ts`, new `src/app/postInterruptContinuationCoordinator.ts`, `src/app/actions.test.ts`, `src/app/controller.test.ts`, new `src/app/postInterruptContinuationCoordinator.test.ts`, and the `test/fakeController.ts` interface stub.
- Prerequisites already present from Tasks 01-03: core continuation reducer state, attested capability verdict, and `settled_interrupted` harness transition.

## Errors / Corrections

- Self-review found that ordinary prompt admission was initially not reserved while Hard Stop proof was pending. `preparePromptDispatch()` now rejects competing sends and admits only the exact continuation request after the reducer reaches `dispatching`.
- `rtk bun run typecheck && rtk bun test` passed: 2,959 passed, 5 skipped, 0 failed across 159 files.
- `rtk bun test src/app/postInterruptContinuationCoordinator.test.ts src/app/actions.test.ts src/app/controller.test.ts` passed: 256 passed, 0 failed.
- `rtk bun test --coverage --isolate` ran 2,959 passing tests with 0 failures and reported 96.50% functions / 97.98% lines overall, but exited 1 because untouched `src/agent/transport.ts` has 76.47% function coverage under the per-file 80% threshold. The new coordinator is 95.24% functions / 93.91% lines.
- `rtk git diff --check` passed.

## Ready for Next Run

- Implementation and task-local verification are green. Leave `task_04.md` pending and do not commit until the inherited `src/agent/transport.ts` coverage gate is resolved or the caller explicitly changes the required gate.
