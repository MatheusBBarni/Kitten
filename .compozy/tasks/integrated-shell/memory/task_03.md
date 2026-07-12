# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implement the PTY-backed `ShellRuntime`, styled active-buffer view, frame-coalesced screen events, in-memory factory, and real-PTY coverage required by task 03.

## Important Decisions

- `StyledRun` carries palette-or-RGB foreground/background plus explicit terminal attributes; `view()` returns only active-buffer viewport rows.
- The runtime accepts an optional scheduler seam while production defaults to the existing `createFrameScheduler`.
- Teardown closes the PTY and sends SIGKILL to the owned shell before awaiting exit, preventing a foreground child from hanging disposal.

## Learnings

- Bun 1.3.13 and `@xterm/headless` 6.0.0 interoperate under Bun; xterm buffer access requires `allowProposedApi: true` and write callbacks before reading parsed cells.
- This machine's default zsh startup blocks on an SSH-key passphrase prompt, so deterministic real-PTY tests use the supported command override `/bin/sh` while production still defaults to `$SHELL`.
- Full coverage passed at 96.95% functions / 98.49% lines overall; `shellRuntime.ts` measured 95.65% functions / 99.57% lines.

## Files / Surfaces

- `package.json`, `bun.lock`: Bun minimum and pinned headless emulator dependency.
- `src/shell/shellRuntime.ts`, `src/shell/shellRuntime.test.ts`, `test/shellRuntime.integration.test.ts`.

## Errors / Corrections

- Initial real-PTY tests timed out because default zsh initialization waited for an SSH passphrase and SIGTERM did not reap the blocked shell; tests now use `/bin/sh` and disposal force-reaps after closing the PTY.

## Ready for Next Run

- Task 03 implementation, coverage, and self-review are complete. Fresh final gate: `bun run typecheck && bun test --coverage` with 835 passing, 0 failing; 96.95% function / 98.49% line coverage overall.
- Task 04 can register OSC handlers at the emulator boundary using the scripted semantic-event/snapshot path already exercised by the in-memory factory.
