# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Build `ModelSelect.tsx` overlay (model+effort, confirmed-state, unverified, inline mid-switch confirm) + `model-select` keymap/binding + `CockpitApp` dispatch/mount. Deps task_04/05 done; store/selectors/actions/types all in place.

## Important Decisions
- Chord: `Ctrl+E` (techspec-suggested; Ctrl+M==CR forbidden; Ctrl+O/T/S taken). Placed in COCKPIT_KEYMAP after `sessions`, so command order becomes switch-focus, hand-off, sessions, model-select, toggle-help, close-help. This shifts keymap.test escape indices to [5, 8].
- Overlay opens always (modal, mounted-then-conditional like other overlays); empty visible-option set shows a plain notice, not a silent no-op.
- Confirmed/unverified derived in-component: track `requested` Map(configId->value); a section's option is `unverified` when `requested.get(id) !== option.currentValue`. Always render `option.currentValue`, never the requested value.
- Established conversation = session `turns.length > 0`. Non-established applies immediately; established swaps to inline confirm (reuses confirm/cancel commands, no new command).
- Choosing the already-current value is a no-op (avoids a pointless warning).

## Learnings
- mockAgent already models config options (task_03): `newSession` returns them, `setSessionConfigOption` mutates currentValue in place + echoes full set, `emitConfigOptionUpdate`, `onSetConfigOption` hook. Good for the confirmed round-trip integration test.
- `selectAgentConfigOptions` returns RAW slice (referentially stable) - must apply `visibleConfigOptions` + memoize in the overlay.

## Files / Surfaces
- new: src/ui/ModelSelect.tsx, src/ui/ModelSelect.test.tsx
- edit: src/ui/keymap.ts (+MODEL_SELECT_KEYMAP/matcher/hints/command/binding), src/ui/keymap.test.ts, src/ui/CockpitApp.tsx (dispatch+mount)

## Errors / Corrections
- The mid-switch warning text wraps across two box lines in the rendered frame, so `frame.includes(MID_SWITCH_WARNING)` never matches contiguously. Tests key on the single-line `MODEL_SELECT_CONFIRM_HINT` + a non-wrapping fragment ("may reduce quality") instead. Same trap applies to any multi-line overlay text.

## Ready for Next Run
- task_06 DONE + committed. `ModelSelect.tsx` exports the reusable control constants/component that task_08 hand-off preview will reuse for its target model/effort control. Chord is Ctrl+E. keymap gained `MODEL_SELECT_KEYMAP` + `matchModelSelectCommand` + `MODEL_SELECT_HINT`/`MODEL_SELECT_CONFIRM_HINT` and a `model-select` COCKPIT_KEYMAP entry (order: after `sessions`). task_07 (status strip) is independent and still pending.
