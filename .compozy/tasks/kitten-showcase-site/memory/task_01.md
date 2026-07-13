# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Establish an independently installable and buildable Astro static site under `site/`, including the placeholder route and checks required by Task 01.

## Important Decisions

- Use the GitHub Pages project-site assumption `https://matheusbbarni.github.io/Kitten`, expressed as Astro `site` plus `base: "/Kitten"`.
- Keep site dependencies exact and site-local; Astro 7.0.3 is the newest release eligible under the repository's 14-day age guard, and TypeScript stays at 6.0.3 because `@astrojs/check` 0.9.9 does not accept TypeScript 7.
- Use Bun for the independent lockfile and test scripts, consistent with the repository runtime.

## Learnings

- Current Astro guidance keeps static output explicit with `output: "static"` and supports strict TypeScript via `astro/tsconfigs/strict`.
- The site-local verification gate is reproducible with `bun install --frozen-lockfile`; config coverage is 100%, Astro diagnostics are clean, and the static build emits `site/dist/index.html`.

## Files / Surfaces

- Site boundary: `site/package.json`, `site/bun.lock`, `site/astro.config.mjs`, `site/tsconfig.json`, and `site/.gitignore`.
- Site source boundary: `site/src/pages`, `site/src/components`, `site/src/scripts`, `site/src/config`, and `site/public`.
- Scaffold checks: `site/test/scaffold.test.ts`.

## Errors / Corrections

- The repository already contained unrelated modified and untracked files; task staging must remain path-scoped.
- Astro 7.0.7 was rejected by Bun's inherited 14-day minimum-release-age guard; corrected the pin to eligible release 7.0.3 rather than bypassing the guard.
- The first `astro check` found the site-local Bun test types undeclared; added exact `@types/bun` plus explicit `types: ["bun"]` within the site boundary so the subproject typechecks independently.

## Ready for Next Run

- Task 01 implementation and self-review are complete. Site gate: 3 tests passed, 100% config coverage, 0 Astro errors/warnings/hints, and one static page built. Root gate: typecheck passed; 1,544 tests passed, 2 credential-gated tests skipped, 0 failed.
- Task-scoped implementation commit: `c2adf2d` (`feat: scaffold standalone Astro showcase site`).
- Future showcase work should stay within the `site/` dependency/source boundary; deployment workflow ownership remains at root under `.github/workflows/` per ADR-003.
