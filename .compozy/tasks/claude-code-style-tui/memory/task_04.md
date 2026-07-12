# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Restyle `PromptEditor` with a palette-accented chevron, rounded chrome, and tuned spacing while preserving all prompt behavior and the unavailable-agent skin.

## Important Decisions

- Keep all existing textarea callbacks, bindings, placeholder constants, and row-growth logic untouched; constrain production edits to the render structure and styles.
- Extend the colocated real-renderer suite instead of creating a new test file.
- Render `❯` in the warm accent when ready and in `status.not_ready` when unavailable, so the disabled skin remains semantically consistent.
- Use the existing palette only for color; layout spacing remains OpenTUI cell units because `CockpitPalette` intentionally has no spacing tokens.

## Learnings

- Task 01 is present in commit `2f2eebd`; `CockpitPalette.accent` is available in every registered palette.
- Pre-change baseline: all 11 existing `PromptEditor` tests pass, but `PromptEditor.tsx` contains only the textarea and no marker element.
- The prompt's fixed-frame contract is also captured by `CockpitApp` and `ConversationView`; the intentional rounded border, chevron, and extra spacing require mechanical updates to their existing snapshots.
- Focused coverage reports `src/ui/PromptEditor.tsx` at 100% functions and 100% lines.

## Files / Surfaces

- Touched: `src/ui/PromptEditor.tsx`, `src/ui/PromptEditor.test.tsx`, `src/ui/__snapshots__/CockpitApp.test.tsx.snap`, `src/ui/__snapshots__/ConversationView.test.tsx.snap`.

## Errors / Corrections

- First full gate: typecheck passed, but 3 fixed-frame snapshots failed on the intentional prompt restyle; 770 tests passed. The affected snapshots were reviewed and updated.
- The same run emitted the pre-existing `runSelfCheck` React `act(...)` warning and `ModelSelect` `theme_mode` listener warnings already recorded in shared memory; these remain commit blockers under the warning-free verification rule.
- After snapshot updates: `bun run typecheck` exits 0; `bun test` exits 0 with 773 passing and 0 failing; `bun run selfcheck` prints `SELF-CHECK OK`. The unrelated warnings still make the pre-commit verdict fail under `cy-final-verify`.

## Ready for Next Run

- Implementation and reviewed visual snapshots are ready in the worktree.
- Task tracking remains pending and no commit was created because the mandatory warning-free pre-commit gate is blocked by the shared workflow risk.
