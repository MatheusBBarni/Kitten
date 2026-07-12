# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Added the task_01 theme preference config delta and its loader coverage.

## Important Decisions

- The task's two preset IDs instantiate the TechSpec's permitted one-to-two curated preset range.
- `AppConfig.theme` is required; direct test fixtures state the default explicitly as `"auto"`.

## Learnings

- `formatIssues` preserves Zod issue paths in `ConfigError`, so invalid-theme coverage should assert the error names `theme`.
- Full coverage was 98.44% lines; the loader itself reached 100% line coverage.

## Files / Surfaces

- `src/core/types.ts`, `src/config/configLoader.ts`, and `src/config/configLoader.test.ts`.
- Direct `AppConfig` test fixtures in controller, readiness, and UI/integration suites.

## Errors / Corrections

## Ready for Next Run

- `AppConfig.theme` is available for task_02 to seed the reactive preferences slice.
