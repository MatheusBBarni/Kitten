# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Build the fail-soft, injected repository-file source and direct coverage defined by task_01, including Git/attribute/ignore policy, terminal and filesystem safety, bounded binary reads/concurrency, complete candidate retention, and lexical output.

## Important Decisions

- Keep all discovery I/O and policy in the new application-layer module; task_02 will own controller/action wiring.
- Treat command, stream, malformed Git output, and filesystem exceptions as typed unavailable results; policy-ineligible individual paths are excluded.
- Treat inconsistent successful ignore output as unavailable so a malformed policy response cannot broaden candidates.

## Learnings

- A live production-source smoke run against the Kitten repository returned a ready result with 787 eligible paths.
- Focused coverage after the final code change is 97.07% lines and 96.55% functions; 9 focused tests pass.
- The full repository gate passes with 1,351 tests passed, the intentional external reload probe skipped, and 0 failures.

## Files / Surfaces

- `src/app/fileDiscovery.ts`: typed contracts, production Bun/filesystem seams, Git policy parsing, bounded safety checks, and deterministic output.
- `src/app/fileDiscovery.test.ts`: direct unit and injected integration coverage for Git, filesystem, safety, failure, and bound behavior.

## Errors / Corrections

- The catalog skill alias resolves to `.agents/skills`, not `~/.codex/skills`; corrected before implementation.
- Bun 1.3.13 requires `./src/app/fileDiscovery.test.ts` to force an explicit test path; the initial no-file baseline exited 1 after finding no matching test file.
- The first typecheck exposed a test-helper `Response` body generic mismatch; replaced it with a directly constructed byte stream before any verification claim.

## Ready for Next Run

- Task 01 is ready for task 02 to import `RepositoryFileList`, `RepositoryFileSource`, and the production `repositoryFileSource` / factory.
