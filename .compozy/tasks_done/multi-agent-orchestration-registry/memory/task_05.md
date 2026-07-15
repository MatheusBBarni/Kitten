# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the explicit focused-parent delegation launch dialog, canonical Ctrl+G and `/delegate` entry points, modal priority, and regression coverage without implementing child runtime lifecycle UI.

## Important Decisions

- Store overlay state captures only `parentId`; task/outcome drafts, validation, pending state, and fail-soft feedback remain component-local.
- The delegation dialog remains mounted but stands down visually and for keyboard input while clarification or approval preempts it, preserving local drafts.

## Learnings

- Mounted-but-hidden preemption preserves task/outcome drafts while clarification or approval owns both paint and keyboard priority.
- OpenTUI input submission and the dialog-level Enter binding can observe the same key; a synchronous ref guard is required to guarantee one launch while the promise is pending.
- Focused coverage is above the task target: `DelegationDialog.tsx` reports 84.62% functions and 99.31% lines; `keymap.ts` reports 100%/100%.

## Files / Surfaces

- Implemented: `src/store/appStore.ts` and `src/store/selectors.ts` own and project the captured-parent overlay slot and modal precedence.
- Implemented: `src/ui/keymap.ts`, `src/ui/CockpitApp.tsx`, and new `src/ui/DelegationDialog.tsx` own Ctrl+G, `/delegate`, local drafts/validation/pending/failure state, preemption, and focus-retaining launch.
- Covered by new `src/ui/DelegationDialog.test.tsx` plus focused additions in `src/ui/keymap.test.ts`, `src/store/appStore.test.ts`, and `src/store/selectors.test.ts`; `test/fakeController.ts` has a deterministic launch-result seam.

## Errors / Corrections

- The worktree already contains extensive unrelated and prerequisite edits; preserve them and keep task 05 changes narrowly scoped.
- OpenTUI's test input treats `pressKey("tab")` as printable text; dialog tests use `pressTab()`, and bracketed paste preserves leading/trailing whitespace for trim assertions.
- The initial `/delegate` help description wrapped in the 80-column help panel and failed its existing full-list contract; shortened canonical copy now passes all 44 `CockpitApp.test.tsx` cases.
- Repository-wide verification is not clean: `bun test` hit the known OpenTUI renderer failure mode and cascaded to 209 UI failures after 1976 passes; `bun test --coverage` also reproduces the unrelated release-workflow `NPM_TOKEN` contract failures. Do not mark complete or auto-commit until the authoritative full gate is clean.

## Ready for Next Run

- Implementation and scoped self-review are complete. Fresh clean evidence: typecheck, self-check, build, diff-check, 240 focused delegation/store/keymap tests, and 44 CockpitApp tests.
- Task tracking remains pending and no automatic commit was created because the required repository-wide test gate is blocked by inherited failures.
