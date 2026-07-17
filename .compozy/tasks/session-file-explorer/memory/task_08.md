# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the Settings Editor tab with a component-local draft, exact `{file}` validation, explicit Save/Cancel/Escape behavior, fixed save-failure feedback, and watcher-safe settled preference updates.

## Important Decisions

- Do not absorb task 06's backend persistence/runtime-reload scope into task 08 without explicit authorization; task 08 is specified as a consumer of that configured action and settled preference.

## Learnings

- The current branch has the task 04 config schema and atomic writer, but task 06 remains pending and the live app has no settled editor preference in `AppStore`, no `ControllerActions.saveEditorPreference`, and no watcher application for `config.editor`.
- `SettingsOverlay.tab` is still `"theme"` only, and `SettingsView` contains no Editor UI, providing the pre-change signal for task 08.

## Files / Surfaces

- Inspected: `src/ui/SettingsView.tsx`, `src/ui/SettingsView.test.tsx`, `src/ui/keymap.ts`, `src/store/appStore.ts`, `src/app/actions.ts`, `src/index.ts`, `test/fakeController.ts`, and task 04/06 tracking contracts.

## Errors / Corrections

- Blocked before code edits: task 08's required Save and watcher integration cannot be implemented against the configured seam because prerequisite task 06 is not present.

## Ready for Next Run

- Complete task 06 (including its task 05 runtime dependency reconciliation), then resume task 08 against the resulting explicit save action and settled runtime preference contract.
