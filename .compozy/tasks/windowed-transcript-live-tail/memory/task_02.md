# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add ephemeral per-session transcript window state, session-scoped actions, and narrow projection selectors without changing semantic or persisted session data.

## Important Decisions

- Window entries live only in `AppState.transcriptWindows`; start and replace reset them, add/delegated-add seed them, and removal paths discard them.
- Reveal increments are finite positive integer deltas capped at `Number.MAX_SAFE_INTEGER`; invalid, unknown, and equivalent actions preserve the complete state reference.
- Projection memoization depends only on addressed turns, enabled-mode status, revealed count, and a matching approval tool id. Detached/anchor-only changes and all non-turn disabled-mode changes reuse the prior projection.
- Active streaming protection names only a working session's agent tail because the reducer can append deltas only to that tail. Clarification overlays do not contribute transcript ownership.

## Learnings

- Task 01's projection source and tests exist as untracked workflow inputs in the dirty worktree; task 02 consumes the source without modifying it.
- The scoped store/selector suite passes 189 tests. Touched-file coverage is above 95% functions and 97% lines.

## Files / Surfaces

- `src/store/appStore.ts`
- `src/store/appStore.test.ts`
- `src/store/selectors.ts`
- `src/store/selectors.test.ts`

## Errors / Corrections

- Corrected the delegated lifecycle fixture to publish `running` before `finished`; the store correctly rejected direct invalid removal.
- Final repository verification remains red in two delegated orchestration integration cases and one delegated telemetry integration case from unrelated dirty controller/telemetry work. The coverage command also exits nonzero on imported pre-existing files below the per-file threshold, although task files exceed the 80% target.

## Ready for Next Run

- Implementation and focused tests are ready for review, but task status, checkboxes, and commit must remain pending until `rtk bun run typecheck && rtk bun test` and the required coverage gate are clean.
