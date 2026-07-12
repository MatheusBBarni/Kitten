# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the config-layer `watchUserConfig` API with real filesystem watching, debounced reloads through `loadAppConfig`, transient failure tolerance, and complete close semantics.
- Required evidence covers debounced external writes, freshly loaded theme values, invalid-then-valid recovery, rename replacement, callback suppression after close, and at least 80% watcher coverage.

## Important Decisions

- The watcher tests own the config service integration boundary and exercise real temporary files instead of mocking `fs.watch` or `loadAppConfig`.
- The test invariant is: a burst of external events for the resolved target emits at most one freshly loaded valid config, while invalid intermediate states and closure emit none.
- Use a target-file watcher for in-place `change` events and a parent-directory watcher for target `rename` events. The directory watcher reattaches the target watcher after atomic replacement, avoiding both stale-inode misses and duplicate callbacks from two producers handling ordinary writes.
- Track an event generation so a reload already in flight cannot emit after a newer event or `close()`.
- Ensure the resolved config parent directory exists before attaching, so an optional config can be created and observed on first run.

## Learnings

- Final focused stress evidence passes 60/60 behaviors across 10 reruns after adding missing-path and post-rename liveness coverage.
- Final full coverage passes 708/708 tests and reports 100% function / 97.18% line coverage for `configWatcher.ts` (overall 96.82% functions / 98.22% lines).
- Final repository gate passes: `tsc --noEmit` clean and `bun test` 708 passed, 0 failed.

## Files / Surfaces

- Added: `src/config/configWatcher.ts`
- Added: `src/config/configWatcher.test.ts`

## Errors / Corrections

- A directory-only watcher missed some immediate in-place write bursts under repeated macOS/Bun runs. A naive dual watcher removed misses but occasionally emitted twice. Event ownership was split by kind (file=`change`, directory=`rename`) and then passed repeated stress runs.
- One intermediate patch introduced an extra closing token; the syntax failure was read directly and corrected before further validation.

## Ready for Next Run

- Task 05 is complete. Task 09 can wire `watchUserConfig` into the store and retain responsibility for idempotent compare-before-apply behavior.
- Implementation commit: `7268df6 feat: add debounced user config watcher` (source and tests only; workflow tracking remains uncommitted by policy).
