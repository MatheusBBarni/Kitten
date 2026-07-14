# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the protocol-free workspace model and pure reducer described by Task 01, including lifecycle, nullable selection, attention epochs, and structural-sharing tests while leaving `SessionState` execution ownership unchanged.

## Important Decisions

- Keep workspace-only transitions in a new `src/core/workspace.ts`; use `src/core/sessionReducer.test.ts` only for the ownership-boundary integration check.
- Treat duplicate labels across different conversations as valid user input per the TechSpec; repeating the same normalized name on one conversation is an identity-preserving no-op.
- Remove successfully closed conversations from active workspace metadata; the exported `closed` lifecycle vocabulary remains available for policy/persistence contracts, while later events for removed IDs are safe no-ops.
- Freeze Visible/Background lifecycle while `teardownState` is `closing`; only `close_succeeded` removes the entry after controller-owned effects succeed.

## Learnings

- The existing next-attention selector excludes the selected conversation and ranks approval, error, then finished; the workspace helper follows the same contract while including Background entries.
- Full-suite coverage is the authoritative threshold signal: `workspace.ts` reached 94.12% functions and 98.79% lines, while a workspace-only coverage invocation exits nonzero because Bun also counts partially loaded `types.ts` functions.

## Files / Surfaces

- `src/core/types.ts`: workspace lifecycle, availability, teardown, attention, state, seed, and event vocabulary.
- `src/core/workspace.ts`: pure factory, reducer, focus fallback, navigation, lifecycle, attention, and ordering helpers.
- `src/core/workspace.test.ts`: exhaustive reducer, no-op, attention, and structural-sharing coverage.
- `src/core/sessionReducer.test.ts`: real workspace/session-reducer ownership-boundary checks.

## Errors / Corrections

- Corrected attention routing during self-review to exclude the current selection, matching the existing selector contract.
- Added lifecycle guards so background/reopen cannot change an entry while teardown is closing.

## Ready for Next Run

- Task 01 implementation and tests are complete. Store integration can consume `WorkspaceState`, `WorkspaceEvent`, `workspaceReducer`, and attention/navigation helpers in Task 02.
- Verification evidence: focused reducers 55 pass / 0 fail; full coverage 1122 pass / 0 fail / 1 opt-in skip; final pre-tracking gate typecheck clean with 1122 pass / 0 fail / 1 opt-in skip.
