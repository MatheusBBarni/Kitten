# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Wire the focused composer to reducer-owned mid-turn steering, compact visible lifecycle status, and lossless one-time recovery, with rendered and real lifecycle coverage.

## Important Decisions

- Preserve `PromptEditor` command/history/reference/ready/restoration precedence and keep Escape as the existing explicit hard-cancel path.
- Consume only `ControllerActions` and narrow store selectors; lifecycle and transport ownership remain outside the UI.
- Treat an active steering submission as accepted only when `actions.steer()` returns `queued`; only then clear the native editor and record prompt history.
- Keep recovery pending when the native editor contains a changed draft. Copy and acknowledge the exact recovery payload only after the native editor is empty, with no automatic resend.

## Learnings

- OpenTUI delivers the content-change callback from programmatic `setText()` after the recovery effect returns. The recovery guard must remain set until that deferred callback observes the copied text, or the local restored notice is cleared prematurely.
- The existing fake controller already contains steering and recovery-acknowledgement spies from prerequisite work; task 06 consumes that seam without taking ownership of the overlapping dirty file.

## Files / Surfaces

- Implemented: `src/ui/PromptEditor.tsx`, `src/ui/PromptEditor.test.tsx`, `test/mockAgent.ts`, and `test/midTurnSteering.integration.test.tsx`.
- Consumed prerequisite dirty surfaces without task-owned edits: `src/app/actions.ts`, `src/app/controller.ts`, `src/app/steeringCoordinator.ts`, store steering selectors/reducer state, and `test/fakeController.ts`.

## Errors / Corrections

- The worktree already contains unrelated and prerequisite changes, including overlapping uncommitted controller/action/fake-controller work. Preserve them and stage only task-06-owned changes.
- The task-focused rendered/integration suite initially exposed a deferred OpenTUI programmatic content-change callback; retaining the recovery guard until that callback fixed the restored-status race.
- Fresh task-scoped verification is green, but the required full `rtk bun run typecheck && rtk bun test` gate is red: typecheck passes, then the suite reports 2440 pass, 4 skip, and 35 failures in the pre-existing dirty delegated-orchestration/controller/agent-run/telemetry/UI state. Task-06 focused tests pass within that run.
- Because the repository-wide gate is not clean, do not mark `task_06.md` or `_tasks.md` complete and do not create the automatic commit.

## Ready for Next Run

- Task-focused evidence: `rtk bun test src/ui/PromptEditor.test.tsx test/midTurnSteering.integration.test.tsx` passes 53 tests; focused coverage reports `src/ui/PromptEditor.tsx` at 96.08% functions and 94.61% lines; `rtk bun run selfcheck` passes.
- Reconcile or remove the unrelated dirty orchestration/controller failures, then rerun the full gate. Only after a clean full gate should tracking be updated and task-owned files be committed narrowly.
