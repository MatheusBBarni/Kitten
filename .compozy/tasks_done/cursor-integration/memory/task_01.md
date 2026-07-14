# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add Cursor as the third closed provider and zero-config session, with runtime-only profile resolution and strict recipe-only user configuration.

## Important Decisions

- Define the certified Cursor runtime-profile contract now, but keep production certification evidence empty. The built-in `agent acp` recipe therefore resolves to `standard` until task_08 supplies reviewed credentialed evidence and an exact version.
- Certification identity compares provider kind, final command, ordered arguments, and complete environment. Display names are deliberately excluded.
- Shared provider metadata owns both the full display name and compact UI/tab label; task_06 will consume it in views.

## Learnings

- Expanding the zero-config fleet exposed a two-session assumption in the shared fake controller: previous navigation always used the next-session path. The fake now models both directions for arbitrary fleet sizes.
- Existing two-provider fixture maps required explicit narrowing where a test intentionally exercises only a subset; production provider records remain exhaustive.

## Files / Surfaces

- Provider/config contracts: `src/core/types.ts`, `src/config/configLoader.ts`, `src/config/clarificationCapability.ts`.
- Closed-identity consumers: `src/persistence/runRecord.ts`, `src/app/actions.ts`.
- Contract and regression coverage: `src/core/types.test.ts`, `src/config/configLoader.test.ts`, provider/session fixtures across agent, app, persistence, store, UI, and integration tests, plus `test/fakeController.ts`.

## Errors / Corrections

- The first full suite found nine stale assertions and fixtures that assumed exactly two default sessions; they were updated to assert the three-session order or intentionally narrow their fixture type.
- The fake controller's previous-direction bug appeared only after adding a third session and was corrected before the final gate.

## Ready for Next Run

- Task 01 is implemented and verified. Cursor resolves as the third zero-config session with a `standard` runtime profile; later readiness/adapter tasks can consume the required `runtimeProfile` field without importing configuration code.
- Fresh evidence: typecheck passed; 1,670 tests passed with 0 failures and 2 credentialed skips; coverage for `src/config/configLoader.ts` is 96.30% functions / 100% lines and `src/core/types.ts` is 100% / 100%; self-check and compiled build passed.
