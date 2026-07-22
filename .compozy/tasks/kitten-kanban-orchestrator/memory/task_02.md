# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Relocate Cockpit production runtime, build implementation, and npm launcher ownership into `packages/tui` while preserving behavior through explicit root compatibility bridges.

## Important Decisions

- Keep the existing root test suite in place for Task 03; root source compatibility must therefore preserve sibling imports without duplicating production ownership.
- Task 03 owns removal of the root source/test bridge; Task 04 owns rebasing/removing public build, bin, CI, release, installer, and documentation bridges.
- Preserve the launcher's historical workspace working directory during the bridge window by executing explicit `packages/tui/...` entrypoints with root `--cwd`; package ownership does not require changing runtime `cwd` yet.

## Learnings

- All 136 relocated runtime files and both launcher files are byte-identical to their prior root owners; every root production bridge resolves to its matching package file.
- Package-local build resolution needs module-relative `PACKAGE_ROOT`/`ENTRYPOINT` and `createRequire(import.meta.url)` for OpenTUI's parser worker; the existing module-relative package-version lookup remains correct after relocation.
- The package coverage gate exercises both package-owned runtime code and the remaining root tests: 3,113 passed, 5 skipped, 0 failed, with 96.73% functions and 98.05% lines.

## Files / Surfaces

- Package owners: `packages/tui/src`, `packages/tui/scripts/build.ts`, `packages/tui/bin`, `packages/tui/package.json`, `packages/tui/tsconfig.json`, and focused build/launcher tests under `packages/tui/test`.
- Temporary bridges: root production paths under `src`, `scripts/build.ts`, and `bin`; removal owners are documented in `packages/tui/COMPATIBILITY.md`.
- Compatibility contracts updated in `test/workspaceBoundary.test.ts`, `test/ciWorkflow.test.ts`, `packages/tui/test/workspaceBoundary.integration.test.ts`, and root `tsconfig.json`.

## Errors / Corrections

- The first focused typecheck rejected direct access to optional `Bun.spawnSync().stdout` in the new self-check integration assertion; normalize missing output to an empty string before asserting.
- Running TUI scripts from the package directory changed the preserved launch `cwd`, causing narrow-layout failures. Keep root working-directory semantics during the bridge window while naming package-owned entrypoints explicitly.

## Ready for Next Run

- Implementation, self-review, final verification, and task tracking are complete. Only the narrow implementation commit remains; tracking and workflow-memory files stay outside the automatic commit.
