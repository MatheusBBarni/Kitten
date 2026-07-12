# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Add Ctrl+S sessions overview: modal overlay listing every session (title, provider, cwd, state), calling out needs-you, with jump-to-next-needy. Modeled on ApprovalPrompt/HandoffPreview modality.

## Important Decisions
- `sessions` overlay slot is a plain `boolean` (open/closed), unlike approval/handoff which carry payload - the overview reads its content from `selectSessionList`.
- KEYMAP_HINT (status strip) left unchanged: precedent is Ctrl+T (the flagship hand-off) is NOT in KEYMAP_HINT either; the overlay's own hint is `SESSIONS_HINT` (like APPROVAL_HINT/HANDOFF_HINT). F1 help panel gains the Ctrl+S row automatically from COCKPIT_KEYMAP.
- Extended `SessionListItem`/`selectSessionList` with `cwd` so the overview reads all four fields "from selectSessionList" per the requirement (toMatchObject test unaffected).
- COCKPIT_KEYMAP order: switch-focus, hand-off, sessions, toggle-help, close-help. Shifts Esc help-panel indices - existing keymap.test.ts assertions updated.

## Learnings
- Overlay modality is two halves that must both be present: the dialog's own `useKeyboard` calls `key.preventDefault()` (stops the focused textarea), AND the shell gates on `selectHasOpenOverlay` returning early in its `onKey` (global listeners fire in mount order; shell mounts first). SessionsOverlay owns no textarea, so close just lets the composer re-focus - no manual focus restore needed.
- Highlight uses arrow-clamp: `clamped = Math.min(selected, Math.max(len-1, 0))` so a status change beneath the cursor never points off the end; `next-session` clamps with `Math.max(len-1, 0)` to guard the empty list.

## Files / Surfaces
- src/store/appStore.ts, src/store/selectors.ts, src/ui/keymap.ts, src/ui/SessionsOverlay.tsx (new), src/ui/CockpitApp.tsx, src/app/actions.ts + colocated tests.

## Errors / Corrections

## Ready for Next Run
- Verified complete: typecheck clean, 530 pass/0 fail, selfcheck OK, coverage 97.8% funcs / 99.0% lines (all touched files >=88%). Task status set completed in task_05.md + _tasks.md.
- task_06 (session-addressed hand-off) reuses this overview as the target picker: `SESSIONS_KEYMAP`/`matchSessionsCommand`, `SessionCard`, and the `selectSessionList` card list are the pieces to lift.
