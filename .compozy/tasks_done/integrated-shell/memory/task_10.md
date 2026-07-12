# Task Memory: task_10.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add in-pane alternate-screen application support: active-buffer rendering, full-height shell layout, complete task-07/task-09 key forwarding, and resize/cwd continuity coverage.

## Important Decisions

- ADR-005 and task_10 intentionally supersede the PRD/ADR-002 full-window takeover mechanism; implement in-pane `@xterm/headless` alternate-buffer rendering.
- Keep alternate-screen state imperative at the runtime boundary and expose a narrow subscription/snapshot API to React; do not wake the immutable shell store or the whole cockpit on every screen revision.
- Size the PTY/emulator from the ShellPane renderable's actual layout dimensions so normal and expanded layouts both report their true drawable rows.

## Learnings

- `@xterm/headless` 6 exposes `terminal.buffer.active.type` (`normal` or `alternate`) and `terminal.buffer.onBufferChange`; DECSET/DECRST buffer transitions are already parsed by xterm.
- OpenTUI's `onSizeChange` fires before nested scrollbox viewport layout is reliable; use the scrollbox renderable's own `width`/`height` for the PTY/emulator resize contract.
- A real `/usr/bin/vi` session enters/exits xterm's alternate buffer under the Bun PTY and preserves both the shell cwd and exported environment after `:wq`.

## Files / Surfaces

- Runtime: `src/shell/shellRuntime.ts`, `src/shell/shellRuntime.test.ts`.
- UI/layout: `src/ui/ShellPane.tsx`, `src/ui/CockpitApp.tsx`, `src/ui/cockpitContext.tsx`, and colocated tests.
- Test doubles/integration: `src/app/controller.test.ts`, `test/shellRuntime.integration.test.ts`.

## Errors / Corrections

- The PRD still describes full-window takeover, but the accepted ADR-005 explicitly supersedes it; no unresolved source conflict remains.
- Default-concurrency repository coverage crashed in Bun after tests; rerunning with `--max-concurrency 1` completed 929 tests with 98.56% line coverage.
- Fresh final verification exits zero but still emits React `act(...)`, OpenTUI `theme_mode` listener-limit, and TreeSitter teardown warnings. Under `cy-final-verify`, task tracking must remain pending and no automatic commit may be created.

## Ready for Next Run

- Functional implementation is present and task-specific tests pass, including live resize, full key forwarding, a real alternate-screen script, and a real vi edit/quit flow.
- Re-run the warning-clean final gate after the repository baseline warnings are resolved; only then mark task_10 checkboxes/status complete and create the authorized local commit.
