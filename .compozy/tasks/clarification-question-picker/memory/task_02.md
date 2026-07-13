# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add ACP-free clarification option/field/payload/outcome contracts and make `awaiting_clarification` a first-class needy session status.

## Important Decisions

- Model fields as a discriminated `mode` union: `single` and `multi` require normalized options; `text` forbids options.
- Keep request identity, connection generation, resolver ownership, and settlement out of `src/core`; status transitions remain ordinary reducer events.
- Rank clarification ahead of existing needy statuses while retaining their relative order and semantics.

## Learnings

- Extending `SessionStatus` also requires compatibility updates in the persisted run schema and the controller teardown helper type, beyond the task's initially listed files.
- The existing palette test already enforces a unique color for every status in every palette.

## Files / Surfaces

- Core contracts/status/reducer tests: `src/core/types.ts`, `src/core/types.test.ts`, `src/core/sessionReducer.test.ts`.
- Attention/store compatibility: `src/core/workspace.ts`, `src/core/workspace.test.ts`, `src/store/selectors.ts`, `src/store/selectors.test.ts`, `src/store/appStore.test.ts`.
- Status presentation compatibility: `src/ui/StatusStrip.tsx`, `src/ui/StatusStrip.test.tsx`, `src/ui/TabWorkspace.tsx`, `src/ui/theme.ts`.
- Exhaustive compatibility: `src/app/controller.ts`, `src/persistence/runRecord.ts`.

## Errors / Corrections

- Red tests initially confirmed missing status/type support; after the first implementation, typecheck identified the controller helper and persistence enum as additional closed unions.
- The store integration assertion initially observed `seen: true` only because the missing status was not needy; once `needsAttention` was fixed, the correct unfocused value was `seen: false` with a new attention epoch.

## Ready for Next Run

- Implementation and self-review are complete. `bun test --coverage` passed with 97.33% functions and 98.31% lines; the full `bun run typecheck && bun test` gate passed with 1,406 tests, 0 failures, and two opt-in external probes skipped; `bun run selfcheck` printed `SELF-CHECK OK`.
- Task tracking is complete; implementation was committed locally as `75b66c8 feat: add core clarification model and status compatibility` and was not pushed.
