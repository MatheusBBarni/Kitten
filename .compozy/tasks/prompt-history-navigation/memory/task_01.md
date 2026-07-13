# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the isolated `src/core/promptHistory.ts` policy and its exhaustive colocated tests.
- Completion requires exact 50-entry retention, adjacent exact-duplicate collapse, immutable navigation, and distinct no-replacement versus clear-composer results.

## Important Decisions

- Keep task 1 protocol-free and independent of `SessionState`; task 2 owns session/store integration.
- Make the navigation result explicit so later layers do not infer clear-versus-no-op behavior from nullable cursor state.
- Export `navigatePromptHistory` with both the next immutable state and one `PromptHistorySelection`; `null` preserves the composer and `""` explicitly clears it.
- Ignore blank submissions by inspection only; retain every accepted prompt string exactly without trimming or other normalization.

## Learnings

- State identity alone cannot represent navigation output: Previous clamped at the oldest entry must still return that text even when state is unchanged.
- An adjacent duplicate reuses the entries reference but must still leave recall mode when the cursor was active.
- Focused coverage reached 100% functions and lines for `src/core/promptHistory.ts`.

## Files / Surfaces

- Added: `src/core/promptHistory.ts`
- Added: `src/core/promptHistory.test.ts`

## Errors / Corrections

- Baseline: both deliverable files are absent, proving the task is not yet implemented.
- The worktree already contains unrelated Compozy tracking and memory changes; preserve them and stage only task-owned files if verification permits a commit.
- Expected red signal: focused Bun test initially failed because `./promptHistory.ts` did not exist.
- Final repository gate: `bun run typecheck && bun test` exited 0 with 1314 passing, 1 intentionally skipped reload probe, and 0 failing tests.

## Ready for Next Run

- The pure policy is ready for task 2 to import into `SessionState` and delegate from `sessionReducer`.
- Session/store/controller/UI integration remains intentionally untouched.
