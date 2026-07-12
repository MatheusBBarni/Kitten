# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the protocol-free shell domain types and a pure immutable reducer with the complete task_01 test contract.

## Important Decisions

- Keep reducer tests colocated in `src/core/shellReducer.test.ts`, matching the existing session reducer suite.
- Use an exported fixed command-ring cap so later shell tasks can share the same bound without duplicating a magic number.
- Treat `screen.rev` as the authoritative revision emitted by the runtime; the reducer copies it without touching command records.

## Learnings

- The TechSpec defines no command-output event; `command_started` therefore opens records with empty raw output and later tasks own output capture.
- The worktree already contains unrelated and overlapping user changes, including additions to `src/core/types.ts`; edits and staging must stay surgical.
- Focused coverage initially exposed the untested runtime guard; its negative test brings `shellReducer.ts` to 100% functions and lines.

## Files / Surfaces

- Touched: `src/core/types.ts`, `src/core/shellReducer.ts`, `src/core/shellReducer.test.ts`.

## Errors / Corrections

- Baseline focused test command found no `src/core/shellReducer.test.ts`, confirming the task is not implemented.
- Initial focused coverage had 93.55% lines but only 75% functions because the runtime exhaustiveness path was untested; add a negative guard test before re-running coverage.
- The full verification gate passed 818 tests but emitted pre-existing React `act(...)` and listener-count warnings from unrelated UI tests; no task files import or touch those surfaces.
- Repository-wide `git diff --check` reports pre-existing trailing whitespace in unrelated UI snapshots; task files contain none.

## Ready for Next Run

- Complete: shell types and reducer are implemented, focused coverage is 100%, typecheck passes, and the full suite passes.
- Later tasks can import `MAX_SHELL_COMMANDS`, `createShellState`, and `shellReducer`; no shared-memory promotion is needed because these contracts are explicit in source and the task packet.
