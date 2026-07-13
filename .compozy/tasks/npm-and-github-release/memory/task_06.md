# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Extend `scripts/build.ts` to stage one npm platform package per selected build artifact while preserving the current checksum-only behavior unless explicitly enabled through `BuildOptions`.

## Important Decisions

- The build CLI reads the release version directly from the repository root `package.json`; this task does not import or depend on `src/version.ts`.
- Platform-package output is opt-in for programmatic `buildAll` callers and enabled by the CLI entry under `dist/npm`.

## Learnings

- A real `build:local` run showed that byte-only staging reset the compiled binary from mode `755` to `644`; the default writer now reapplies the source mode, while injected writers remain filesystem-free.
- Coverage must be scoped to `test/build.test.ts` for this task. Including the compiled-artifact integration test instruments the entire bundled application graph and fails the global threshold despite `scripts/build.ts` exceeding 80%.

## Files / Surfaces

- Touched: `scripts/build.ts`, `test/build.test.ts`, and `test/build.integration.test.ts`.

## Errors / Corrections

- Corrected the initial default copy implementation after the real CLI build exposed lost executable permissions.
- The broad two-file coverage command exited non-zero because it instrumented unrelated bundled modules; the correctly scoped unit coverage passed at 96% functions and 89.40% lines.

## Ready for Next Run

- Task implementation is verified: the CLI generates `dist/npm/@kitten/<slug>`, programmatic `buildAll` remains opt-in, and task 07 can resolve the staged executable names declared by each manifest.
