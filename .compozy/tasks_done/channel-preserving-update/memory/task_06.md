# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Align source help, compiled help, packaged-launcher help, and README guidance around the finalized channel-preserving `kitten --update` behavior.

## Important Decisions

- Keep the help examples-first and add update discovery there, in Usage/Options, and in one concise channel/recovery block.
- Put README update guidance directly after the two existing installation alternatives so the initial npm command remains the first shell command and the showcase section stays untouched.
- Prove help paths only with `--help`; assertions must not invoke `--update`, live network access, or a real package-manager mutation.

## Learnings

- The pre-task help still uses the disallowed abbreviations `npm i -g` and `| sh`; README has no public update section yet.
- The worktree contains pre-existing staged `kitten-orchestrator` moves and pre-existing unstaged Task 01-05 tracking plus Task 04 source/test changes. Preserve them and stage Task 06 narrowly.
- Focused source/README tests pass 56/56; compiled help passes 2/2; packed launcher passes 5/5; typecheck passes after correcting one tuple-inference-only test error.
- The fresh repository gate `rtk bun run typecheck && rtk bun test` passes with 2,911 tests, 5 credential-dependent skips, and 0 failures; `rtk bun run selfcheck` and `rtk bun run build:local` also pass.
- Full coverage executed 2,916 tests with 2,911 passing, 5 intentional skips, and 0 failures. Task-owned `src/index.ts` is 81.63% functions / 91.96% lines and aggregate coverage is above 80%, but the command exits 1 because unchanged `src/agent/transport.ts` remains at the inherited 76.47% per-file function floor.

## Files / Surfaces

- Touched: `src/index.ts`, `README.md`, `test/firstRunBoot.test.ts`, `test/build.integration.test.ts`, `test/npm-launcher.integration.test.ts`, `test/package-shim.test.ts`, `test/readmeInstall.test.ts`.

## Errors / Corrections

- Replaced `argv.includes("--help")` in the parameterized metadata test with an expectation discriminator because TypeScript inferred only the tuple elements common to both cases.
- Do not mark tracking complete or auto-commit unless the mandatory final gate is clean; the inherited transport coverage floor is outside this documentation task.
- Final scope review found no Task 06 edits to the showcase, installer script, launcher behavior, updater logic, registry, release workflow, task status, or master task graph. `git diff --check` passes.

## Ready for Next Run

- Implementation and scoped verification are complete. Resolve or explicitly waive the inherited `src/agent/transport.ts` per-file coverage failure before completing tracking or creating the automatic commit.
