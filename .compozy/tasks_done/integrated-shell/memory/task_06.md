# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add a fully resolved shell policy to app config and enforce it at the controller-to-runtime boundary.

## Important Decisions

- Keep xterm's existing 1,000-line runtime default as the config default; accept integer scrollback values from 0 through 100,000 to allow disabling history while bounding memory.
- Resolve the command from `$SHELL`, falling back to `/bin/sh` when the environment does not provide one.
- Treat `shell.enabled: false` as an intentional unavailable shell state and do not invoke the runtime factory.

## Learnings

- The current controller ownership work from task 05 already creates the runtime through `ShellRuntimeFactory`; task 06 only needs to gate that call and pass the resolved command and scrollback.
- Pre-change, `parseAppConfig` rejects `shell` as an unknown top-level key.
- Making `AppConfig.shell` required exposed two inline controller-test fixtures that bypassed typed config constants; both now include the resolved shell policy.
- The shell config loader and controller paths are fully covered by direct tests; repository coverage reports 100% functions/lines for `configLoader.ts` and 97.30% functions/99.49% lines for `controller.ts`.

## Files / Surfaces

- Production: `src/core/types.ts`, `src/config/configLoader.ts`, `src/app/controller.ts`.
- Behavioral tests: `src/config/configLoader.test.ts`, `src/app/controller.test.ts`, `test/shellRuntime.integration.test.ts`.
- Required `AppConfig` fixture updates: readiness, session-status, approval, hand-off preview, and model-select tests.

## Errors / Corrections

- The first targeted run had 110 passing and 2 failing tests because those inline fixtures omitted `shell`; production behavior was correct, and updating the fixtures produced 112 passing tests.
- Final verification exits 0 with 859 tests passing and coverage above 97%, but emits unrelated React/OpenTUI warnings; task status and checkboxes remain pending and no automatic commit was created.

## Ready for Next Run

- Implementation and task-specific tests are ready. Re-run the warning-clean final gate after the repository warning baseline is repaired, then update task tracking and create the single local commit.
