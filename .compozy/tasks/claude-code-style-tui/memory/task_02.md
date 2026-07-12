# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add fail-soft XDG first-run state and a validated `welcomeBanner` preference without using the config write path.

## Important Decisions

- Treat loaded `AppConfig.welcomeBanner` as required because `defaultAppConfig` and `mergeAppConfig` produce a fully populated config; only the on-disk user delta is optional.
- The repository now contains a settings-owned `configWriter`; this task will not remove or use it. The task's read-only requirement is enforced by keeping first-run persistence entirely in `appState.ts` and adding no write behavior to `configLoader.ts`.

## Learnings

- Zod is pinned at 4.4.3; current Zod 4 guidance favors `z.strictObject`, `z.enum`, `safeParse`, and `z.iso.datetime()` for the state boundary.
- Pre-change reproduction: parsing `{ "welcomeBanner": "off" }` fails as an unrecognized top-level key.
- Focused coverage exits non-zero because it includes unrelated `src/core/types.ts` functions, but reports 100% function and line coverage for both `appState.ts` and `configLoader.ts`. The repository-wide coverage gate passes at 96.68% functions and 98.27% lines.

## Files / Surfaces

- Added: `src/config/appState.ts`, `src/config/appState.test.ts`.
- Updated: `src/config/configLoader.ts`, `src/config/configLoader.test.ts`, `src/core/types.ts`.
- Updated typed `AppConfig` fixtures in controller/readiness/UI/session-status tests to carry the required default `welcomeBanner: "auto"` field.

## Errors / Corrections

- Initial typecheck found 11 existing `AppConfig` fixtures missing the new required field; fixtures were updated to the loaded-config default rather than weakening the type to optional.

## Ready for Next Run

- `readFirstRunSeen`, `markFirstRunSeen`, `resolveAppStatePath`, and `bannerVariant` are ready for task_05/task_06 boot and idle-screen wiring.
- Fresh evidence: `bun run typecheck && bun test` passed 764 tests; `bun test --coverage` passed with 96.68% function and 98.27% line coverage.
- Source and tests were committed locally as `9ec2547` (`feat: add fail-soft first-run state and welcome banner preference`); workflow tracking remains outside the commit.
