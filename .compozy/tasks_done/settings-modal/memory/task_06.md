# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the global `Ctrl+,` settings command and the settings overlay keymap, matcher, help/status discoverability, caveat documentation, and required unit/integration coverage.

## Important Decisions

- Keep the synthesized OpenTUI `KeyEvent` integration assertion in `src/ui/keymap.test.ts`, the canonical suite for key dispatch; it exercises the real `KeyEvent` class without duplicating the matcher contract in a second file.
- Derive the new status and settings hints from their keymap rows so binding labels cannot drift from dispatch.

## Learnings

- A real OpenTUI `KeyEvent` can be constructed directly from a `ParsedKey` shape, which keeps the required integration assertion at the keymap boundary without a renderer.
- Full-label status hints overflow the existing strip contract; `HELP_ENTRIES` carries `Ctrl+,` while the status strip uses the equivalent compact `^,`.

## Files / Surfaces

- `src/ui/keymap.ts`: cockpit/settings commands, bindings, matchers, derived hints, and Kitty delivery caveat.
- `src/ui/keymap.test.ts`: unit and real-`KeyEvent` integration coverage.
- `src/ui/StatusStrip.test.tsx`: compact hint visibility and chord assertion.
- `src/ui/__snapshots__/CockpitApp.test.tsx.snap`, `src/ui/__snapshots__/ConversationView.test.tsx.snap`: intentional status-hint frame updates.

## Errors / Corrections

- The first derived status hint expanded to 39 characters and regressed the established 80-column strip layout (4 status failures plus 2 snapshots). Corrected the production hint to the strip's effective 18-cell budget as `^O swap ^, F1 help`; help continues to show full `Ctrl+,`.

## Ready for Next Run

- Task 06 implementation and tracking are complete; Task 08 can consume `SETTINGS_KEYMAP`, `matchSettingsCommand`, and `SETTINGS_HINT`, and Task 10 can dispatch `open-settings`.
- Verification evidence before tracking: focused keymap suite 72/72, full coverage suite 718/718; overall coverage 96.82% functions / 98.22% lines and `src/ui/keymap.ts` 100% / 100%.
