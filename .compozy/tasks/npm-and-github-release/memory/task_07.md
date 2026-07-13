# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Replace the Bun/source npm entry shape with a Node launcher plus four exact-pinned platform optional dependencies, prove the host package via local tarballs, and make the npm commands the README hero.

## Important Decisions

- Keep `bin/kitten.mjs` as the executable binding and put its dependency-injected launcher logic in a sibling `.mjs` module so Bun can measure branch coverage without executing the CLI on import.
- Preserve the repository's existing runtime/development dependency split; task 07 changes only the package entry/files/engine/optional-dependency distribution contract.

## Learnings

- Current Node/npm docs confirm `createRequire(import.meta.url)`, `spawnSync(..., { stdio: "inherit" })`, local tarball installs, `bin` maps, and optional platform dependency filtering support the TechSpec design.
- Installing local tarballs for both the shim and host platform package makes npm create the `kitten` bin link while preserving Node resolution of the exact `@kitten/<slug>/kitten-<slug>` subpath.
- The host local-pack test proves the installed launcher prints package version `0.0.0` and reaches `SELF-CHECK OK` when invoked explicitly with `node`.

## Files / Surfaces

- Added `bin/kitten.mjs` and `bin/launcher.mjs`.
- Updated `package.json`, `bun.lock`, `README.md`, and `test/dependencies.test.ts`.
- Added `test/launcher.test.mjs`, `test/package-shim.test.ts`, and `test/npm-launcher.integration.test.ts`.

## Errors / Corrections

- Initial dependency reclassification broke existing source dependency contracts during typecheck and exceeded the TechSpec's named package-field scope; restored the original split before integration validation.

## Ready for Next Run

- Task 08 can publish each generated platform package before the main shim; the launcher and exact-pinned optional-dependency contract are now established.
- Implementation committed locally as `89463dc` (`feat: add Node launcher for npm package`); tracking and workflow-memory files remain outside the commit.
- Fresh gate evidence after the last implementation change: frozen install, typecheck, diff check, npm pack dry-run, tests, coverage, self-check, and build all exited 0.
- Test evidence: 1536 passed, 2 expected opt-in skips, 0 failed; overall coverage 97.33% functions / 98.30% lines; `bin/launcher.mjs` coverage 100% functions / 96.77% lines.
