# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add controller-level whole-run restore with independent per-session degradation, persisted focus, and replay-safe event ordering.

## Important Decisions

- Resolve ADR-004's contradictory sequencing in favor of its stated invariant and the task regression: for live reload, bind the stored ACP id, subscribe to updates, then call `loadSession`, so updates emitted during the load call reach the freshly reset slice.
- A missing stored id or absent `canLoadSession` capability starts a fresh session but records restoration as `unavailable`; a thrown load degrades that session without blocking its peer.

## Learnings

- `AgentConnection.loadSession` returns `void`, so the restored ACP binding is the persisted session id; only the unsupported/missing-id fallback gets a new result id from `newSession`.
- A synchronous replay event emitted inside the fake `loadSession` reaches the reducer when the slice is reset first and the permanent update subscription is installed before invoking load.

## Files / Surfaces

- `src/app/controller.ts`: public restore entry point plus independent per-session reconnect/load-or-new orchestration.
- `src/app/controller.test.ts`: replay, ordering, failure isolation, fallback, and focus-settle unit cases.
- `test/sessionRestore.integration.test.ts`: writer-produced record restored into populated panes through fake connections.
- `src/index.ts` and existing `SessionController` test doubles: forward or satisfy the new public restore method.

## Errors / Corrections

- The worktree already contains extensive unrelated and dependency changes, including pre-existing edits in controller source/tests. Preserve them and do not stage or commit unrelated content.
- Repository-wide tests and coverage both exit 0 but emit the inherited OpenTUI warning: `Possible EventTarget memory leak detected. 11 theme_mode listeners added to [CliRenderer]`. Per the shared workflow memory and final-verification contract, this blocks completion tracking and the automatic commit.

## Ready for Next Run

- Focused evidence: `rtk bun test src/app/controller.test.ts test/sessionRestore.integration.test.ts` passed 67 tests with 0 failures; `rtk bun run typecheck` exited 0.
- Full evidence: `rtk bun test` passed 1,032 tests with 1 skipped and 0 failures; `rtk bun test --coverage` passed the same suite with 96.81% functions / 98.43% lines overall and 89.36% functions / 98.11% lines for `src/app/controller.ts`.
- Self-review and targeted `git diff --check` found no task-scope defects.
- Keep `task_07.md` pending and do not commit until the inherited warning is removed and the full warning-free gate is rerun.
