# Task Memory: task_10.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Wire the existing `open-settings` keymap command and `SettingsView` into `CockpitFrame`, emit `settings_opened`, preserve approval precedence, and prove modal focus stand-down/restoration through the real OpenTUI shell.

## Important Decisions

- Keep `ApprovalPrompt` as the last overlay and mount `SettingsView` immediately before it; `SettingsView` already self-gates while approval is open.
- Leave `StatusStrip` unchanged because both its compact hint and the help panel already derive the settings chord from `COCKPIT_KEYMAP`.
- Extend the existing `src/ui/CockpitApp.test.tsx` integration suite with real store, renderer, keyboard, focus, and recorder behavior instead of mocking shell internals.
- Treat the fixed 80x24 open-settings frame as the task-required product-contract snapshot; retain explicit behavioral assertions for dispatch, telemetry, precedence, and focus.

## Learnings

- Pre-change `CockpitApp.tsx` has no `open-settings`, `SettingsView`, or `settingsOpened` wiring; the existing 11-test cockpit suite passes without exercising settings.
- The OpenTUI test renderer exposes `renderer.currentFocusedEditor`, which can directly prove composer blur and focus restoration.
- Full verification passed with 744 tests, 0 failures, 98.23% line coverage, 96.61% function coverage, clean typecheck, and `SELF-CHECK OK`.
- The full suite still prints the pre-existing React `act(...)` and OpenTUI listener-count diagnostics already recorded in shared workflow memory; no new warning class appeared.

## Files / Surfaces

- Touched: `src/ui/CockpitApp.tsx`, `src/ui/CockpitApp.test.tsx`, and `src/ui/__snapshots__/CockpitApp.test.tsx.snap`.

## Errors / Corrections

## Ready for Next Run

- Shell integration is implemented and verified. `StatusStrip.tsx` required no edit because the compact `^,` hint and help entry already derive from the keymap table.
