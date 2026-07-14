# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Make the dev entrypoint, compiled binary, and ACP handshake report the exact `package.json.version`, with examples-first `--help` and unchanged unknown-flag fallthrough.

## Important Decisions

- `dispatchCliFlags` owns only metadata flags and returns `false` for all other argv, leaving the existing self-check/cockpit dispatch unchanged.
- `--version` takes precedence over `--help` when both are present; both write to stdout and exit 0 through injectable production seams.
- Help leads with runnable examples and includes the npm/npx upgrade command plus the standalone curl install/upgrade command.

## Learnings

- The existing `test/firstRunBoot.test.ts` is the canonical suite for entrypoint predicates and injected exit/output behavior.
- The existing mock ACP agent exposes the real initialize request through `onInitialize`, so client metadata can be asserted without mocking adapter internals.
- The host compile integration test can exercise `--version` and `--help` on the same generated binary after its existing self-check.

## Files / Surfaces

- `src/version.ts`, `src/version.test.ts`
- `src/index.ts`, `test/firstRunBoot.test.ts`
- `src/agent/agentConnection.ts`, `src/agent/agentConnection.test.ts`
- `test/build.integration.test.ts`

## Errors / Corrections

- The intentional red run failed because `src/version.ts` and the new CLI exports did not yet exist; the targeted suites passed after production implementation.
- The worktree contains unrelated Compozy task/memory edits; keep them outside this task's commit.

## Ready for Next Run

- Task implementation, self-review, tracking, and the scoped local commit are complete. Fresh gates: typecheck exit 0; 1,504 tests passed with 0 failures; coverage 97.30% functions / 98.33% lines; self-check and host build passed; compiled `--version`/`--help` passed. Do not push unless requested.
