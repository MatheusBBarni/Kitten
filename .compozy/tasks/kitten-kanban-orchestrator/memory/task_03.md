# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Relocate all Cockpit tests and fixtures into `packages/tui`, remove root `src`/`test` ownership, and make package-local lifecycle/configuration authoritative without behavior changes.

## Important Decisions

- Preserve the historical workspace working directory in lifecycle commands while narrowing test and coverage file selectors to `packages/tui/src` and `packages/tui/test`.
- Keep root `tsconfig.json` as workspace coordination for package-owned TUI source/tests; remove every root source/test discovery path.

## Learnings

- The pre-change boundary has 155 tracked root test/fixture files and package scripts/config explicitly consume root `src`/`test`.
- The new root-ownership regression test fails before relocation because the root `src` bridge exists, providing the required red baseline.
- The first package-only suite run reached 3,014 passing tests and isolated all 27 failures to two relocation-relative contracts: the colocated config loader README fixture path and the CI coverage-script literal.
- A second broad run exposed test fixtures that intentionally used the former root `src`/`test` directories as valid session workspaces; rebasing those fixtures to `packages/tui/src` and `packages/tui/test` preserves their distinct-directory intent without recreating root ownership.
- Final package evidence is 3,041 passing tests, 5 credentialed skips, 0 failures across 156 files; coverage passed the enforced 80% threshold, typecheck passed, self-check reported `SELF-CHECK OK`, and the host build completed.

## Files / Surfaces

- `packages/tui/src/**` colocated tests and snapshots.
- `packages/tui/test/**` contract tests and shared fixtures.
- `packages/tui/package.json`, `packages/tui/tsconfig.json`, root `tsconfig.json`, and package workspace-boundary contracts.
- Temporary root `src/**` and `test/**` compatibility surfaces.

## Errors / Corrections

- The initial nested-test pathspec did not include root-direct `src/update.test.ts` and `src/version.test.ts`; restored those exact tracked files from `HEAD` before moving them into `packages/tui/src`.
- Rebased the config loader README fixture four levels to the workspace root and updated the CI contract to the package-only coverage selector.
- Corrected the migrated installer contract to continue targeting the root-owned public installer, narrowed the build compatibility assertion to the Task 04 build/bin bridges, and moved same-provider workspace fixtures under `packages/tui`.

## Ready for Next Run

- Task 03 is complete. Task 04 can remove the remaining root build/bin compatibility bridges without any root source/test consumer dependency.
