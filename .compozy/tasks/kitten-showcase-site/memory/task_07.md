# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add an independent GitHub Pages workflow that rebuilds the Astro subproject and deploys only `site/dist` on pushes to `main` or input-free manual dispatch.

## Important Decisions

- Use separate `build` and `deploy` jobs so Pages cannot search for an artifact before the site build and upload finish.
- Pin every third-party action to an immutable commit SHA with its release tag documented inline.
- Disable Astro telemetry explicitly in the CI build environment; do not add secrets, analytics, or release-workflow dependencies.
- Validate both the built `site/dist/index.html` and the deploy action's `page_url`, emitting GitHub annotation errors when either is missing.

## Learnings

- `site/package.json` already exposes `build`, and `site/astro.config.mjs` already targets the `/Kitten` project base path.
- An old `site/dist/index.html` existed before Task 07, so validation must execute a fresh build rather than treating file presence alone as evidence.
- The final local build produced one static route plus hashed CSS and the proof asset; the upload path contains no symlinks.
- Task-owned validator coverage is 100% functions and lines; the full site suite is 98.98% lines.

## Files / Surfaces

- `.github/workflows/showcase-site.yml`
- `scripts/validateShowcaseSiteWorkflow.ts`
- `test/showcaseSiteWorkflow.test.ts`

## Errors / Corrections

- The installed workflow skills resolve from `.agents/skills/`, not `~/.codex/skills/`; corrected before implementation.
- The first test-only validator produced no measurable source coverage; extracted the contract into a pure module so the required coverage target can be evidenced.
- The invalid-contract fixture produces 17 distinct diagnostics, not 18; corrected the test count after the first focused coverage run while retaining 100% validator coverage.
- RTK needed `proxy` for local `find`/`tar`, and macOS `bsdtar` lacks GNU `--hard-dereference`; the portable archive simulation succeeded after explicitly verifying the output tree has no symlinks.

## Ready for Next Run

- Implementation and self-review are complete. Fresh gates: Astro check 0 errors/warnings/hints; 67 site tests pass; site build emits one page; task validator 10/10 at 100%; root typecheck plus 1,618 tests pass with 0 failures and 2 credential-dependent skips.
- Task 08 can consume the deployed Pages URL exposed as `jobs.deploy.outputs.page_url`; no shared-memory promotion was needed because this contract is explicit in the workflow.
