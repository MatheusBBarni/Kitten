# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Migrate only direct complete controller/readiness `AppConfig` fixtures to the required default-off transcript-windowing field; keep boot and first-run paths unchanged.

## Important Decisions

- Added `transcriptWindowingEnabled: false` to seven direct controller literals and the readiness base fixture; spread-derived fixtures inherit the field without redundant overrides.
- Kept `src/config/firstRun.test.ts` and `test/firstRunBoot.test.ts` as audited no-change boundaries.

## Learnings

- After the scoped edits, typecheck reports no stale complete `AppConfig` literals in the controller/readiness family; remaining TS2741 errors are in UI and integration fixture families assigned outside task 04.
- Targeted controller startup, resilience/send-prompt, and disposal coverage passes (30 tests), while the complete controller file is currently red in pre-existing delegated-run/worktree tests.

## Files / Surfaces

- `src/app/controller.test.ts`
- `src/config/readiness.test.ts`
- Audited only: `src/config/firstRun.test.ts`, `test/firstRunBoot.test.ts`

## Errors / Corrections

- Focused four-file run: 260 pass, 20 fail. All failures are in pre-existing route-authorized agent-run and dynamic-conversation tests; one isolated failure expects running children but receives failed terminal snapshots.
- Coverage run has the same 260/20 test result, so the 80% clean coverage gate cannot be established in the current dirty workspace.
- Full typecheck remains blocked by stale fixtures in UI and integration test families outside task 04.

## Ready for Next Run

- Re-run the four focused files, coverage, and full `bun run typecheck && bun test` after the concurrent fixture-family and delegated-run/worktree work is reconciled. Do not mark task 04 complete or commit until those gates are clean.
