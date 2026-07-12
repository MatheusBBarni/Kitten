# Task Memory: task_13.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add opt-in, content-free resume outcome, degradation, first-action, picker-interactive, and load-usable telemetry for picker and last-run restores.

## Important Decisions

- Keep first-post-resume classification inside `TelemetryRecorder.watch`: `sessionResumed` arms one global first-action window after replay settles, and the next user turn is reduced to a character count before `detectReexplanation` decides `continued`.
- Thread an explicit `"picker" | "last-run"` mode through `SessionController.restore`; the controller owns load-start/settle and per-pane outcome emission, while the picker owns open-to-interactive timing.
- Use dedicated content-free duration events for picker interactive and load usable timing; emitted records expose only fixed enums, ids, booleans, counts, and milliseconds.

## Learnings

- `createCockpitSession` currently performs last-run restore before `recorder.watch`; arming first-action from the post-restore `sessionResumed` call remains safe because `watch` primes replayed turns before any later developer action.
- The worktree contains extensive pre-existing changes from earlier PRD tasks. Task 13 must preserve them and avoid staging tracking files or unrelated hunks.
- Targeted task suites pass (124 tests) and `bun run typecheck` passes after the first implementation pass.
- Repository-wide `git diff --check` is currently blocked by pre-existing trailing spaces in generated UI snapshot rows; task-specific source files do not introduce those diagnostics.
- Focused coverage ran all 124 selected tests and measured task-owned modules above the requested floor: recorder 97.48% lines, controller 95.86%, and SessionPicker 94.85%. The focused command exits 1 only because Bun applies the global 80% threshold to transitive modules whose suites were not selected.
- Fresh full non-coverage tests pass: 1081 passed, 1 opt-in reload probe skipped, 0 failed. The run still emits inherited OpenTUI listener, React `act(...)`, and TreeSitter warnings.

## Files / Surfaces

- Touched production: `src/telemetry/recorder.ts`, `src/app/controller.ts`, `src/ui/SessionPicker.tsx`, `src/ui/CockpitApp.tsx`, `src/index.ts`.
- Touched tests/support: `src/telemetry/recorder.test.ts`, `src/app/controller.test.ts`, `src/ui/SessionPicker.test.tsx`, `test/sessionPicker.integration.test.tsx`, `test/fakeController.ts`.

## Errors / Corrections

- `git diff --check` exits 2 only on pre-existing `CockpitApp` and `ConversationView` snapshot whitespace, so it cannot serve as a clean repository-wide task gate without touching unrelated snapshots.
- Full `bun test --coverage` exits 133 after Bun 1.3.13 crashes with signal 5 during UI tests; before the crash it shows the task tests passing and repeats the inherited warnings.
- Fresh `bun run selfcheck` exits 1: Codex reload is confirmed, while Claude reload is blocked by organization policy disabling Claude Code subscription access. This matches the existing shared workflow risk.

## Ready for Next Run

- Implementation, required unit/integration coverage, typecheck, task-scoped diff check, and line-by-line self-review are done.
- Task remains pending: do not mark checkboxes/status complete and do not commit until full coverage is warning-free/non-crashing and selfcheck can confirm Claude reload with usable credentials/policy.
