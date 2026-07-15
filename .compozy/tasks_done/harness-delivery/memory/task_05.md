# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add a fixed, per-session degraded-start notice and an explicit `/new` recovery path that preserves a rejected first-task draft without putting task content in store notice state.

## Important Decisions

- Keep persisted `harnessDeliveries` checkpoints intact for task_04; add a separate ephemeral notice projection containing only fixed enums.
- Derive and publish notice state alongside controller checkpoint publication. Non-failed delivery states clear the notice and remain visually silent.
- Retain rejected task blocks memory-only inside the existing action layer, not in `PromptEditor` or store state. `PromptEditor` remains harness-agnostic; `/new` asks `startFreshFromContext` to use the retained blocks.

## Learnings

- `/new` currently creates a separate conversation except for unavailable-restoration context. Harness recovery must add the focused failed-notice branch before that normal path.
- `sendPrompt` prepares dispatch before recording the visible turn, so a pre-dispatch harness failure returns `null` without creating transcript content and the action can retain the rejected blocks safely.
- A restored failed checkpoint intentionally has no task payload. `/new` must still replace that generation and clear the notice, while sending no fabricated task.

## Files / Surfaces

- Touched: `src/core/types.ts`, `src/store/appStore.ts`, `src/store/selectors.ts`, `src/app/actions.ts`, `src/ui/ConversationView.tsx`, `src/ui/CockpitApp.tsx`, `test/fakeController.ts`, `src/store/appStore.test.ts`, `src/app/controller.test.ts`, and `src/ui/ConversationView.test.tsx`.
- Deliberately unchanged: `src/ui/PromptEditor.tsx` and persistence schema files; the editor remains harness-agnostic and the notice is ephemeral.

## Errors / Corrections

- The worktree already contains uncommitted prerequisite task_01-task_04 changes, including checkpoint persistence and controller delivery state. Preserve these and stage only task_05 changes if verification permits a commit.
- Initial design placed rejected text in `PromptEditor`; corrected to action-layer memory so the editor gains no harness coupling and failed content never enters the notice projection.
- Full `bun test` is not a clean completion gate in this worktree: the fresh run ended with 1,852 pass, 4 skip, and 203 fail after compiled-host/Tree-sitter teardown invalidated shared UI state. The task-focused suite remains clean.
- Full `bun test --coverage` likewise exits nonzero with inherited repository-wide per-file coverage failures and the same UI cascade. Task-owned core/store/view files are above 80% line coverage; the large pre-existing `CockpitApp.tsx` remains 76.59% overall.

## Ready for Next Run

- Implemented the fixed enum-only notice, session-isolated structural sharing, silent healthy rendering, fixed failure copy, focused keyboard `/new` recovery, definitely-unsent task retention, and notice clearing after replacement.
- Fresh focused gate: `bun run typecheck` plus `bun test src/store/appStore.test.ts src/ui/ConversationView.test.tsx src/app/controller.test.ts` -> 279 pass, 0 fail.
- Fresh runtime/build evidence: `bun run selfcheck` -> `SELF-CHECK OK`; `bun run build:local` -> success.
- `git diff --check` is clean.
- Task remains pending. Do not update `task_05.md` or `_tasks.md`, stage, or commit until the repository-wide test and coverage gates are clean.
