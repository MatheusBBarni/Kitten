# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the typed `site/src/config/showcase-config.ts` contract and validation tests that keep launch copy, proof metadata, the sole install route, and repository data consistent.

## Important Decisions

- Use the source-development route as the sole `verified-route` entry. The current public npm package named `kitten` is an unrelated Octopress exporter, so `npx kitten` and `npm i -g kitten` cannot be marked as verified showcase routes.
- Keep recording URLs nullable until the authentic launch asset exists, paired with non-empty proof fallback and accessible-description copy so builds and renders remain safe.
- Derive the repository URL and source-install command from `repoOwner` and `repoName`, while keeping one command record marked `source: "verified-route"`.

## Learnings

- The live Git remote is `MatheusBBarni/Kitten`; repository constants must preserve that owner/name casing for links and the later GitHub API integration.
- The site scaffold already has a Bun test harness and strict Astro check/build scripts; the pre-change config-test command fails because `showcase-config.test.ts` does not exist yet.
- The finished config validator has 100% function and line coverage. The site gate passes 10 tests with clean Astro diagnostics and a one-page static build; the root gate passes typecheck plus 1,551 tests with 2 credentialed skips and 0 failures.

## Files / Surfaces

- Planned task-owned surfaces: `site/src/config/showcase-config.ts`, its colocated test, and the minimal `site/src/pages/index.astro` import/render seam.
- Implemented surfaces: `site/src/config/showcase-config.ts`, `site/src/config/showcase-config.test.ts`, and `site/src/pages/index.astro`.

## Errors / Corrections

- Corrected the stale planning assumption that the currently documented npm command is a verified public route after checking live npm metadata.
- Corrected one site-relative Git diff path before running the focused tests; no source change was required.
- Removed the inherited `FORCE_COLOR` value during the broad verification command so the final gate produced no color-environment warning.
- The first post-tracking gate placed Bun's `--cwd` flag after the script name and stopped at `Script not found "typecheck"` after all site checks passed. A follow-up cross-directory form ran site tests but printed Bun help instead of running Astro scripts, so the final clean gate executes site scripts from `site/` and root scripts from the repository root.

## Ready for Next Run

- Task 02 is complete. The typed config, validator, tests, and Astro import seam are committed locally as `5c75ec5` (`feat: add typed showcase config contract`).
- Task tracking and workflow-memory files remain intentionally outside the automatic commit. Task 03 can render all page sections from the exported config values; Task 05 can reuse the repository and star-state contract.
