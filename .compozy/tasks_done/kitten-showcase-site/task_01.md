---
status: completed
title: Create standalone Astro subproject scaffold
type: frontend
complexity: medium
---

# Task 01: Create standalone Astro subproject scaffold

## Overview

Create an isolated `site/` project so the showcase website can be built, tested, and published independently from the Bun/OpenTUI cockpit runtime. This establishes the deployment seam required by ADR-003 and avoids coupling page build dependencies to terminal-release tooling. The task sets the baseline directories and config needed for all later implementation tasks.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON WHAT — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST create a standalone `site/` directory with a separate dependency boundary from repo root.
2. MUST add `site/package.json` with explicit scripts for `dev`, `build`, `preview`, and `check` (or `astro check`) to support development and CI.
3. MUST add `site/astro.config.mjs` targeting static output into `site/dist` for GitHub Pages.
4. MUST create required source folders (`site/src/pages`, `site/src/components`, `site/src/scripts`, `site/src/config`) and `site/public` so later tasks can add assets and modules without path churn.
5. SHOULD include a lockfile strategy that supports reproducible installs in CI.
</requirements>

## Subtasks

- [x] 01.01 Create `site/` with `package.json`, `astro.config.mjs`, and TypeScript config scaffolding.
- [x] 01.02 Add base directories for pages, components, scripts, config, and public assets.
- [x] 01.03 Add a `src/` `index` placeholder route that renders a temporary placeholder while subsequent tasks replace it.
- [x] 01.04 Wire strict mode and base URL assumptions for a Pages deploy target.
- [x] 01.05 Document in task notes which files become the ownership boundary for all future site changes.

## Implementation Details

Build the project shell so later tasks can assume an independent toolchain and publish target:

- `site/package.json`: package metadata, scripts, and dependency declarations.
- `site/astro.config.mjs`: static output configuration and base path assumptions.
- `site/tsconfig.json`: TypeScript options matching this repo's style while keeping the site build independent.
- `site/astro.config.mjs` and root `site/src`/`public` directories: structure foundation.

This task implements the implementation boundary from PRD technical constraints and ADR-003 ("standalone site subproject").

### Relevant Files

- `site/package.json` — defines an independent dependency surface and task scripts.
- `site/astro.config.mjs` — determines render mode and GitHub Pages output target.
- `site/tsconfig.json` — ensures predictable TypeScript behavior in the new project.
- `site/src/pages` — entry route folder.
- `site/src/components` — presentational components for later milestones.
- `site/public` — static assets and recording/media payloads.

### Dependent Files

- `.compozy/tasks/kitten-showcase-site/task_02.md` — depends on scaffold to add typed config and page components.
- `.compozy/tasks/kitten-showcase-site/task_03.md` — depends on runnable site scaffolding.
- `.github/workflows/showcase-site.yml` — requires a distinct build target to deploy in task_07.

### Related ADRs

- [ADR-003: Keep showcase delivery as a separate Astro subproject in `site/`](../adrs/adr-003.md) — defines the repository boundary.

## Deliverables

- Scaffolded `site/` project with Astro config and scripts.
- Reproducible directory layout for all subsequent showcase implementation tasks.
- Unit checks that the site manifest and static config are present and valid.
- Integration build check in place for the new scaffold (`site` can at least execute its build bootstrap without content errors).
- Unit test coverage target: >=80% for scripts/config added in this task.

## Tests

- Unit tests:
  - [x] `node -e "import('./site/astro.config.mjs')"` should not throw and must expose `output: 'static'` (or equivalent static mode signal used by Astro config).
  - [x] Package manifest parser check confirms required scripts and static build dependencies are declared.
- Integration tests:
  - [x] `cd site && bun run check` (or `bunx astro check`) returns success with the placeholder route.
  - [x] `cd site && bun run build` produces `site/dist`.
- Test coverage target: >=80% for any scripts/config validators added in this task.
- All tests must pass.

## Success Criteria

- All tests passing
- Test coverage >=80% on any implemented scripts/config verification in task_01
- `site/` can be bootstrapped and built independently from repository root scripts.
- No root source files were modified for site bootstrap work.
