# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Harden delegated terminal settlement, parent replacement, and confirmed parent close without changing ordinary conversation-close behavior.

## Important Decisions

- Reuse the existing per-runtime teardown path for cascade close. Successful child teardown removes the terminal child atomically; failed cancellation or disposal leaves the child visible with a terminal `failed` snapshot and `teardown-failed` availability.
- Serialize a parent cascade with the existing `closePromises` entry for the parent and mark delegation close intent before touching children.
- Abort parent removal or replacement when any owned child teardown fails; this avoids silently orphaning a visible failed child.

## Learnings

- Task 3 already generation-fences lifecycle publication and the pure reducer already makes terminal snapshots immutable.
- The pre-task gap is in controller ownership: ordinary parent close and per-session replacement do not currently cascade owned child runtimes.
- `startNewRun` enumerates every runtime, including delegated children; parent replacement must exclude owned children from the replacement list so the parent cascade remains the sole teardown owner.

## Files / Surfaces

- Touched: `src/app/controller.ts`, `src/app/controller.test.ts`, `src/store/appStore.ts`, `src/store/appStore.test.ts`, and `test/sessionRestore.integration.test.ts`.

## Errors / Corrections

- The old Task 3 controller test expected parent replacement to leave a frozen delegated child record. Task 4 changes that contract to cascade teardown and remove old ownership; child-only replacement remains generation-fenced.
- Changed `restoreSession` to return a boolean so a failed child cascade cannot be misreported as a successful fresh-context replacement.
- Focused verification is clean: typecheck plus the orchestration, store, controller, orchestration-integration, and restore-integration suites passed 272 tests with 0 failures and 1,298 assertions.
- The full coverage run exceeded the 80% target (`96.02%` functions and `96.33%` lines overall; controller `95.32%`/`94.86%`, store `97.14%`/`98.09%`, orchestration `96.00%`/`99.48%`) but exited non-zero with the known release-workflow token assertions plus broad OpenTUI renderer failures under the full instrumented run.
- The canonical `bun run typecheck && bun test` gate is not clean: typecheck passed, then the test run reported 1,970 passed, 4 skipped, and 202 failed. The two release-workflow failures reproduce independently; representative renderer failures pass independently (58/58), so they are broad-run instability rather than Task 4 regressions.
- Scoped `git diff --check` passed. No task tracking checkbox/status update and no automatic commit are allowed while the canonical gate remains non-clean.

## Ready for Next Run

- Implementation and task-focused tests are ready for review, but Task 4 remains pending until the inherited full-suite gate is clean.
- Do not broaden Task 4 to repair `.github/workflows/release.yml` or unrelated OpenTUI full-run instability; rerun the canonical gate after those repository issues are resolved, then update tracking and commit only if it is fully clean.
