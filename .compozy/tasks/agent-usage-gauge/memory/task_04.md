# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the primitive `selectSessionHeadroom(sessionId)` selector and prove its honest unknown handling and per-session isolation.

## Important Decisions

- Keep the derivation entirely in `src/store/selectors.ts`; domain state continues to store only raw `usage`.
- Follow the TechSpec formula exactly and return `null` for absent usage or `size <= 0`.

## Learnings

- A scoped coverage run passes every selector test and covers `selectors.ts` above 80%, but exits non-zero because Bun also thresholds supporting modules loaded by that single test file.
- The repository-wide `bun run test:coverage` is the authoritative coverage gate and passed at 97.00% functions / 98.24% lines overall; `selectors.ts` reached 98.70% / 97.17%.

## Files / Surfaces

- Touched: `src/store/selectors.ts`, `src/store/selectors.test.ts`, this task memory, and `task_04.md` tracking.

## Errors / Corrections

- The scoped coverage command exited 1 due to unrelated partially loaded modules below the global threshold; confirmed the task target with the full configured coverage gate instead of weakening coverage settings.

## Ready for Next Run

- Dependency task 01 is present in commit `865543f`; its task file is already marked completed.
- Selector returns only `number | null`; no derived headroom was added to domain state.
- Fresh full gate passed with 1,266 tests, 1 intentional skip, and 0 failures.
- Source and tests were committed locally as `17a4716` (`feat: add session headroom selector`); tracking and workflow-memory files remain outside the commit by instruction.
