# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implement a pure structural key-to-VT encoder with complete task-specified unit coverage and a representative OpenTUI-to-runtime integration path.

## Important Decisions

- Keep the encoder in `src/shell` with its own `ShellKey` structural type so the shell layer does not depend on OpenTUI or the UI layer.
- Return `Uint8Array | undefined`; use standard xterm navigation/function sequences and ASCII control-byte semantics.
- Prove integration with real OpenTUI `KeyEvent` objects feeding the existing in-memory `ShellRuntime`, without spawning a PTY.

## Learnings

- Pre-change baseline: `src/shell/keyEncoder.ts` and both requested test suites are absent; the targeted Bun test filter matches no file.
- The task-owned unit coverage command reports 100% functions and 100% lines for `src/shell/keyEncoder.ts` (46 passing cases).
- The OpenTUI-to-in-memory-runtime integration test passes and observes the exact bytes `0x6c 0x73 0x0d` for `ls` plus Enter.
- Fresh repository verification passes typecheck and all 906 tests, but still emits the shared baseline React `act(...)`, OpenTUI `theme_mode` listener-limit, and destroyed TreeSitter warnings.

## Files / Surfaces

- Implemented: `src/shell/keyEncoder.ts`, `src/shell/keyEncoder.test.ts`, `test/keyEncoder.integration.test.ts`.

## Errors / Corrections

- The repository contains broad unrelated user changes; stage and commit only task-07-owned paths if verification permits.
- Running coverage with the integration suite imports the existing shell-runtime graph and fails the aggregate threshold even though the encoder row is 100%; use the colocated unit suite for the task-owned coverage proof and run the integration suite separately.
- `cy-final-verify` requires a warning-clean full gate. The existing unrelated warnings block task status/checklist updates and the automatic commit despite zero test failures.

## Ready for Next Run

- Encoder implementation and task-owned tests are ready for review. Re-run `rtk bun run typecheck`, `rtk bun test`, and the task coverage/integration commands after the shared warning baseline is cleaned; only then update `task_07.md` and create the local commit.
