# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the app-layer focused-session proposal flow over `ControllerActions.sendPrompt`, parse only post-boundary agent turns, and return proposal/invalid/unavailable outcomes without secondary content persistence.

## Important Decisions

- Keep the orchestration dependency structural: injected `ControllerActions` plus an injected store read surface; do not add an ACP response channel or hold a connection.
- Treat exactly one newly appended agent turn as the only parse candidate after `sendPrompt` settles; all other cardinalities recover explicitly.

## Learnings

- The workspace conversation availability projection is sufficient for the app-layer readiness gate; the flow does not need an ACP type or connection.
- The existing `sendPrompt` terminal contract preserves the required ordering: post-request agent turns are complete in the store before the action resolves.
- Focused coverage reports `src/app/statuslineFlow.ts` at 100% functions and 100% lines; the full suite remains above the 80% repository target.

## Files / Surfaces

- Added `src/app/statuslineFlow.ts` for the product prompt, transcript-boundary orchestration, strict parser call, and recovery results.
- Added `src/app/statuslineFlow.test.ts` with injected-action unit fixtures and a normal-transcript integration fixture.
- Updated this task memory and `.compozy/tasks/statusline-customization/task_05.md` after verification.

## Errors / Corrections

- Response cardinality must be checked before blank-text handling so two empty agent turns remain an invalid multiple-response outcome instead of being mistaken for silence.

## Ready for Next Run

- Task 05 is implemented and verified. Task 06 can wire these normalized proposal/unavailable/invalid-response outcomes into the overlay without introducing raw-content persistence.
- Fresh gate: typecheck; 1,850 tests passed, 3 opt-in contract tests skipped, 0 failed; self-check OK; compiled build succeeded.
