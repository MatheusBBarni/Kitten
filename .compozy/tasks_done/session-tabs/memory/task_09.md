# Task Memory: task_09.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the single captured-target rename/close dialog slot and mounted UI, with approval precedence and modal input ownership.
- Cover rename normalization, status-aware close outcomes, target identity, focus restoration, and no input leakage.

## Important Decisions

- Keep dialog state in AppStore and bind every action to the `sessionId` captured when the dialog opens; never consult later selection.
- Use only AppStore and `ControllerActions` from the UI; rename/background remain runtime-free and close effects stay controller-owned.
- Keep the tab-dialog component mounted but visually and behaviorally inert while approval is open, so approval owns every key while the captured target and rename draft survive safely.
- Do not add tab-strip or Sessions-overlay launch affordances in this task; those lifecycle entry points belong to the later Sessions overlay task.

## Learnings

- `useAppSelector`/`useSyncExternalStore` selectors must return stored references or primitives; allocating a new derived object per snapshot causes an infinite render loop.
- Close-choice navigation needs a ref alongside React state so an arrow press followed by Enter in the same input batch confirms the newly highlighted choice.
- Clearing a tab-dialog slot when its target session is removed prevents a stale modal from surviving controller-owned teardown.

## Files / Surfaces

- Added `src/ui/TabDialog.tsx` and `src/ui/TabDialog.test.tsx` for rename, close policy, approval precedence, captured identity, focus restoration, and input-leak coverage.
- Updated `src/ui/CockpitApp.tsx` to mount the dialog below the topmost approval prompt and `src/ui/keymap.ts` with canonical dialog commands and hints.
- Updated `src/store/appStore.ts` and `src/store/appStore.test.ts` so target removal clears the slot and immutable open/replace/aggregate-gate behavior is covered.

## Errors / Corrections

- Replaced an allocating conversation/status selector after the first focused test exposed React's external-store snapshot loop.
- Added synchronous selected-choice tracking after the active-choice test exposed stale state for arrow-plus-Enter in one batch.
- Adjusted two rendered-text assertions to tolerate terminal line wrapping without weakening the consequence checks.

## Ready for Next Run

- Completed locally. Fresh final gate: `rtk bun run selfcheck && rtk bun run typecheck && rtk bun test` passed with SELF-CHECK OK, 1,219 passing tests, one intentional opt-in ACP probe skipped, and zero failures.
- Fresh coverage: 96.90% functions and 98.16% lines overall; `TabDialog.tsx` reached 100% functions and 97.27% lines.
- Task tracking is complete; implementation is ready for the authorized local commit. No shared-memory promotion was warranted because the learnings are task-local implementation details.
