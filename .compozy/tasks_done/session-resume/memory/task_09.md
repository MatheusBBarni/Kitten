# Task Memory: task_09.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the project-scoped Ctrl+R session picker end to end: canonical keymap/help/hint wiring, modal fuzzy list and preview, controller restore, and behavior-first unit/integration coverage.
- Pre-change baseline: the focused keymap/CockpitApp suites pass (103 tests), but Ctrl+R maps to `null` and no `src/ui/SessionPicker.tsx` exists.

## Important Decisions

- Keep task 09 scoped to current-project listing and restore. Cross-project widening and delete remain follow-up tasks from the wider PRD.
- Test at three owning layers: pure keymap matching, picker component behavior, and real OpenTUI cockpit dispatch with an injected RunStore/fake controller.
- Thread the boot-created RunStore and project cwd through `CockpitSession` -> `renderCockpit` -> `CockpitApp` rather than opening a second persistence boundary inside the view.
- Keep ordinary printable keys with the focused filter input while the picker intercepts arrows, Space, Enter, and Escape; `selectHasOpenOverlay` makes the shell and composer stand down.

## Learnings

- The persisted picker projection exposes the focused agent's `lastPrompt`, message count, branch, and activity time; the full hand-off summary remains available through `load` for Space preview.
- Focused coverage reports `SessionPicker.tsx` at 94.74% functions / 95.19% lines and `keymap.ts` at 100% / 100%; full coverage reports 96.87% functions / 98.33% lines.

## Files / Surfaces

- Added `src/ui/SessionPicker.tsx`, `src/ui/SessionPicker.test.tsx`, and `test/sessionPicker.integration.test.tsx`.
- Updated `src/ui/keymap.ts`, `src/ui/CockpitApp.tsx`, `src/ui/main.tsx`, `src/index.ts`, `test/fakeController.ts`, their owning tests, and status-frame snapshots for the new `^R resume` hint.

## Errors / Corrections

- Initial focused run failed only because existing cockpit snapshots lacked the required `^R resume` hint; snapshots were updated after isolating the exact frame diff.
- The plain full suite reaches the UI tests and then Bun 1.3.13 crashes with signal 5 after repeated inherited OpenTUI `theme_mode` listener and TreeSitter-destroyed warnings. This matches the shared workflow risk and blocks clean tracking/commit.
- Full coverage completes with 1,055 pass, 1 skipped real-adapter probe, 0 failures, but still emits inherited renderer warnings.
- Exact `bun run selfcheck` passes the headless view and Codex reload, but exits 1 because organization policy disables Claude Code subscription access; direct `bun run src/index.ts --self-check` passes.

## Ready for Next Run

- Implementation and focused evidence are ready for review, but task status/checklists and auto-commit must remain pending until the repository has a warning-free full suite and the required real-adapter selfcheck can pass.
