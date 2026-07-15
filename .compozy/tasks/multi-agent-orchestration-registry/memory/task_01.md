# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the protocol-free flat delegation state, pure reducer, selectors, and deterministic coverage required by task 01.

## Important Decisions

- Model state as normalized parent and child records; preserve parent child-id order and unchanged record identities.
- Carry terminal timestamps only on terminal publication events; terminal snapshots are exactly-once and never rewritten.
- Treat aggregate status as `active`, `needs_input`, or `settled`; cleanup eligibility is derived only from terminal state, without clocks.
- Enforce the TechSpec lifecycle matrix: ordinary finish follows `running`; startup and needs-input states may still fail or cancel safely.

## Learnings

- The pure core reaches 96% function and 99.48% line coverage with the task-focused unit and integration suite.
- Repository-wide typecheck passes, but the full test gate is independently blocked by two release-workflow assertions against the checked-in npm-token configuration.

## Files / Surfaces

- Touched: `src/core/types.ts`, `src/core/orchestration.ts`, `src/core/orchestration.test.ts`, `test/orchestration.integration.test.ts`, and this task memory.

## Errors / Corrections

- Strict typecheck required explicit terminal-event narrowing before reading `at`; the reducer now also rejects non-finite terminal timestamps as identity-preserving no-ops.
- Full `rtk bun run typecheck && rtk bun test` is not clean: `test/releaseWorkflow.test.ts` has 2 failures because `.github/workflows/release.yml` contains `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` while the committed tests require token-free OIDC publishing. Neither file is modified by this task.

## Ready for Next Run

- Implementation, focused tests, integration coverage, typecheck, and self-review are done.
- Keep task status pending and do not commit until the unrelated full-suite release-workflow failures are resolved and the full gate is rerun cleanly.
