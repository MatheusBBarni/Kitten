# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add selector-owned fixed `explore` availability/restriction/denial presentation to the delegation dialog, with typed launch handling and preserved modal-local drafts/focus.

## Important Decisions

- Keep advisory availability captured for the dialog parent; launch remains authoritative through `startExploreChild`.
- Keep all operator copy fixed and exhaustive over the closed `ExploreDenialReason` union; never render runtime/config/error/task content.
- Extend child selector presentation with immutable explore policy facts for task 05 consumers, but do not render those session/tab surfaces in task 04.
- Suppress the selector-provided live explore policy cue after a child becomes terminal so later UI work cannot imply a current guarantee for settled history.

## Learnings

- Baseline dialog already calls `startExploreChild`, but collapses denied results and thrown failures into generic `DELEGATION_FAILURE` state.
- Baseline dialog does not call `exploreAvailability` and renders no fixed role or restriction summary.
- The fake controller currently records typed explore launches in the legacy `startDelegatedChild` call log, so the seam cannot prove the dialog avoided the unrestricted action.
- OpenTUI wraps the fixed restriction summary at terminal width; mounted tests assert every textual clause while selector tests assert the canonical full string.
- Selector policy presentation is cached by the immutable accepted snapshot, while the containing delegation presentation remains stable through token-stream and unrelated-session updates.

## Files / Surfaces

- Planned: `src/store/selectors.ts`, `src/store/selectors.test.ts`, `src/ui/DelegationDialog.tsx`, `src/ui/DelegationDialog.test.tsx`, `test/fakeController.ts`, and fake-controller coverage as needed.
- Touched: `src/store/selectors.ts`, `src/store/selectors.test.ts`, `src/ui/DelegationDialog.tsx`, `src/ui/DelegationDialog.test.tsx`, `test/fakeController.ts`, `test/fakeController.test.ts`, and one `src/ui/TabWorkspace.test.tsx` fixture required by the extended selector type.

## Errors / Corrections

- Preserve pre-existing dirty changes in task 01-03 tracking, workflow memory, `CONTEXT.md`, `src/app/controller.ts`, `src/app/controller.test.ts`, and `src/index.ts`; they are outside task 04.
- The first repository coverage run timed out in `test/npm-launcher.integration.test.ts`; the test passed alone in 10.6s and the clean full retry passed, so the first failure was suite contention rather than a product regression.

## Ready for Next Run

- Implementation, self-review, typecheck, the 2,307-test suite, 80% coverage gate, self-check, and compiled build are clean.
- Task tracking is complete; stage only task 04 product/tests plus `task_04.md` and this task memory file, excluding unrelated dirty work.
