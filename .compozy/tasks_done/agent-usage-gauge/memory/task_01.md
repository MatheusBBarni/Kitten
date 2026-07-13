# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the protocol-free raw usage fact to the domain event, session state, reducer, and canonical reducer/store tests.

## Important Decisions

- Follow ADR-003 and the TechSpec refinement: unknown usage is `undefined`, despite ADR-001's older implementation note describing an explicit unknown object.
- Keep the integration assertion in the existing `src/store/appStore.test.ts` suite; no new test file or store production change is needed.

## Learnings

- `createAppStore.applyEvent` already provides the required integration seam and preserves untouched session slice identity without production changes.
- Full coverage gate passed at 97.00% functions and 98.24% lines; `sessionReducer.ts` measured 90.91% functions and 98.18% lines.

## Files / Surfaces

- Touched: `src/core/types.ts`, `src/core/sessionReducer.ts`, `src/core/sessionReducer.test.ts`, `src/store/appStore.test.ts`.

## Errors / Corrections

- The worktree contains unrelated session-tabs and unified-mcp-config tracking changes; preserve them and exclude them from this task's commit.

## Ready for Next Run

- Task implementation and tests are complete; task_02 can translate ACP `usage_update` into the new protocol-free event.
