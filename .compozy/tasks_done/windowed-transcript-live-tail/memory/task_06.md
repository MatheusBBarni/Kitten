# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Migrate direct `AppConfig` literals in the named runtime integration fixtures to the required default-off transcript-windowing contract while leaving `defaultAppConfig()` spread helpers unchanged.

## Important Decisions

- The current orchestration integration contains two direct delegated-runtime `AppConfig` literals, not the one reflected in the original task wording. Both require the explicit false value so the named file typechecks; no assertions or feature behavior change.

## Learnings

- The pre-change typecheck reports the expected two ask-user and two orchestration omissions, plus out-of-scope omissions in session-status, shell-runtime, and telemetry integration families assigned to other migration tasks.
- After the task-local edits, typecheck no longer reports either named file; only the three out-of-scope fixture families remain.
- The ask-user child-answer continuation test and all clarification/cockpit/index inherited-default tests pass. Existing delegated-runtime tests are red in the current dirty workspace (`startDelegatedChild` returns `null` or children become failed), independent of the disabled config literal.

## Files / Surfaces

- Edited: `test/askUserMcp.integration.test.ts`, `test/orchestration.integration.test.ts`.
- Audited unchanged boundaries: `test/clarificationLifecycle.integration.test.tsx`, `test/cockpitSession.test.ts`, `test/index.integration.test.tsx`.

## Errors / Corrections

- Focused five-file run: 45 passed, 3 failed. Failures are existing orchestration behavior in two orchestration cases and the concurrent ask-user child case; no assertion was changed.
- Final `bun run typecheck && bun test` gate stops at typecheck on out-of-scope `sessionStatus`, `shellRuntime`, and `telemetry` config literals.
- Coverage was attempted with `bun test --coverage --isolate`, but the suite remains red on inherited delegation/telemetry failures, so the >=80% clean coverage gate is not established.

## Ready for Next Run

- Task implementation diff is limited to four explicit `transcriptWindowingEnabled: false` fields. Keep task status pending and do not commit until the other fixture migrations and inherited delegation failures are resolved, then rerun focused tests, coverage, and the full gate.
