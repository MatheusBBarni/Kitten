# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Make `AppStore` the current-run owner of session-addressed explorer state, transitions, generation fencing, cleanup, and narrow selectors, with the task's required isolation and integration coverage.

## Important Decisions

- Keep `ExplorerNotice` inside each session-owned explorer position. The TechSpec's illustrative wrapper-level `notice` conflicts with its own per-session prose and task_01's explicit two-session notice/restoration tests; the executable acceptance contract requires isolated notices.

## Learnings

- Although the current `DomainSessionEvent` union includes `cwd_changed`, `sessionReducer` does not handle it and throws. Do not broaden this store task into that unrelated core seam; workspace-root replacement is exercised through the supported `replaceSessions` lifecycle and stale commit fencing.

## Files / Surfaces

- `src/store/appStore.ts`: added current-run explorer types/state, focused-pane support, immutable session transitions, generation-fenced directory request commits, and lifecycle cleanup.
- `src/store/selectors.ts`: added narrow visibility, focus, addressed-session, focused-session, and visible-position selectors while preserving slice identity.
- `src/store/appStore.test.ts`: covered hidden defaults, session isolation, focus/visibility transitions, stale-result fences, workspace replacement, cleanup, and no-op identity.
- `src/store/selectors.test.ts`: covered allocation-free projections, unrelated-session selector stability, and focus-switch restoration.

## Errors / Corrections

- The requested TechSpec section names (`State Model and Store Actions`, `State Invariants`) do not exist verbatim; the governing details are under `Data Models`, `Data Flow`, store/selector testing requirements, and the task's explicit requirements.
- The first root-change test drove `cwd_changed` and failed at the pre-existing reducer exhaustiveness guard. Corrected the test to use `replaceSessions`, which is the store's supported workspace-identity replacement path.
- The final non-isolated broad suite had one unrelated timing failure in `Markdown > registers capabilities on a direct multi-block mount before code rendering`; the exact test passed immediately in isolation, while the full isolated coverage suite passed 2,585 tests with zero failures.

## Ready for Next Run

- Task implementation and self-review are complete. Fresh verification: focused store/selector suites passed 202 tests; full isolated coverage passed 2,585 tests with 0 failures and measured `appStore.ts` at 97.92% functions / 98.93% lines and `selectors.ts` at 98.01% functions / 99.76% lines; typecheck and runtime self-check passed.
- No shared-memory promotion: the implementation details and the unrelated Markdown flake are either task-local or already discoverable from repository sources.
