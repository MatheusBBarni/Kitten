# Task Memory: task_09.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the branch event/reducer path and populate it asynchronously at controller boot, focus changes, and completed prompt turns.

## Important Decisions

- The controller owns the injected branch reader and gives actions a synchronous scheduling callback; actions never await git.
- Boot reads start only after `startSession` has reset/bound every session slice.
- Per-session generations prevent an older read from overwriting a newer boundary result.
- A null read dispatches a blank branch event; the reducer normalizes blank to `undefined` so the slot is actually hidden after a previously successful read.

## Learnings

- Starting a branch read before `store.startSession` is unsafe because the session reset can erase an early result.
- Focus-switch integration is covered through the real controller, action surface, reducer, and store with only the git I/O reader injected.

## Files / Surfaces

- `src/core/types.ts`
- `src/core/sessionReducer.ts`
- `src/core/sessionReducer.test.ts`
- `src/app/controller.ts`
- `src/app/controller.test.ts`
- `src/app/actions.ts`

## Errors / Corrections

- The first boot-wiring attempt launched reads before session slices were reset; focused tests exposed the lost updates, and the reads were moved after startup binding.
- Fresh coverage passes at 98.44% lines with 800 tests, but the full suite/self-check still emits the pre-existing React `act`, OpenTUI listener, and TreeSitter teardown warnings recorded in shared memory.

## Ready for Next Run

- Implementation and assigned tests pass, including null clearing and non-blocking turn refresh.
- Do not mark complete or auto-commit until the required warning-free final gate is available, unless the workflow policy changes.
