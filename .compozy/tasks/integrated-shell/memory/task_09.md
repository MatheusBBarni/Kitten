# Task Memory: task_09.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Route pane focus, shell input, and Ctrl+C so exactly one pane owns the keyboard and shell interrupts never tear down Kitten.

## Important Decisions

- Bind the VS Code-style `Ctrl+\`` chord and document `F2` as the legacy-terminal fallback; both map to the single `toggle-shell` command.
- Keep input routing in `CockpitApp`: overlays remain highest precedence, the toggle remains available in shell focus, and every other encoded key is written only to the ready shell runtime.
- Keep agent-focused Ctrl+C teardown at the boot boundary in `src/index.ts`, where renderer/controller lifecycle already lives; shell-focused Ctrl+C is left to the UI encoder path.
- Use a textual `focused` pane title in addition to accent color so focus is never color-only.
- Emit `shell_activated` from the first semantic `command_started` store event, not the first forwarded key, so navigation/function keys do not inflate activation telemetry.

## Learnings

- The task_07 encoder and task_08 pane/runtime context are present in the worktree even though integrated-shell tracking is stale.
- The task_11 recorder surface is not present yet; task_09 needs only the `shell_activated` invocation seam and must not silently implement the other task_11 events.
- Baseline focused tests pass, but the current renderer contract explicitly asserts `exitOnCtrlC: true` and the cockpit keymap has no shell toggle.
- Bun 1.3.13 does not establish job control when a preconstructed reusable `Bun.Terminal` is passed to `Bun.spawn` (`SESS=0`, `TGPID=0`); passing terminal options directly lets Bun create the controlling PTY and foreground group, which is required for byte `0x03` to interrupt the foreground command.

## Files / Surfaces

- Planned: `src/ui/keymap.ts`, `src/ui/CockpitApp.tsx`, `src/index.ts`, their existing unit/integration suites, and the task-local recorder invocation seam needed for `shell_activated`.
- Runtime correction required by the interrupt acceptance test: `src/shell/shellRuntime.ts` spawn-time PTY construction.
- Touched: `src/ui/keymap.ts`, `src/ui/CockpitApp.tsx`, `src/ui/PromptEditor.tsx`, `src/index.ts`, `src/shell/shellRuntime.ts`, `src/telemetry/recorder.ts`, and their existing unit/integration suites.

## Errors / Corrections

- `_tasks.md` and dependency checkbox/status fields are stale relative to the actual task_07/task_08 source; repository code is the effective dependency signal.
- Initial Ctrl+C verification failed because injected test renderers retained OpenTUI's `exitOnCtrlC: true`, and the real `/bin/sh` PTY lacked job control due to reusable-terminal spawn semantics. Test renderers must mirror production config; the runtime must let `Bun.spawn` create its terminal.

## Ready for Next Run

- Functional implementation and acceptance tests are in place. Focused verification: 144 tests passed, 0 failed; `git diff --check` clean.
- Full coverage: 923 tests passed, 0 failed; 97.26% functions and 98.56% lines.
- `bun run selfcheck` prints `SELF-CHECK OK` but emits a React `act(...)` warning.
- `bun run typecheck && bun test` exits 0 with 923 passing tests but emits the known React `act(...)` and OpenTUI `theme_mode` listener warnings.
- Per `cy-final-verify`, task status and checkboxes remain pending and no commit was created. Re-run the full warning-clean gate after the repository warning baseline is fixed.
