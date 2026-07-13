---
status: completed
title: Add GitHub Pages workflow for site build and deployment
type: infra
complexity: high
---

# Task 07: Add GitHub Pages workflow for site build and deployment

## Overview

Create the deployment pipeline that builds the `site/` Astro artifact and publishes `site/dist` to GitHub Pages. This task is the final integration seam from repository source to public URL and enables launch on the intended medium.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON WHAT — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add a GitHub Actions workflow in `.github/workflows/showcase-site.yml` that builds `site/` and publishes static output for Pages.
2. MUST configure workflow permissions and deployment provider settings for Pages-safe publish.
3. MUST include explicit dependency installation and a clean `cd site` build command chain.
4. MUST avoid triggering analytics or behavioral tracking in CI.
5. SHOULD pin action versions and keep deployment steps deterministic.
</requirements>

## Subtasks

- [x] 07.01 Add workflow trigger(s) for push to `main` and manual dispatch.
- [x] 07.02 Add setup, install, build, and deploy steps for the `site` package artifact.
- [x] 07.03 Configure Pages upload and deployment actions with the repository target environment.
- [x] 07.04 Add failure visibility and output checks in deployment step.
- [x] 07.05 Ensure workflow does not depend on release pipeline state.

## Implementation Details

This task maps to TechSpec integration point "GitHub Pages" and PRD phased rollout requirement of public launch delivery.

- `.github/workflows/showcase-site.yml`: CI workflow for build and deployment.
- `site/package.json`: ensure required scripts exist for CI path.

### Relevant Files

- `.github/workflows/showcase-site.yml` — deployment workflow.
- `site/package.json` — scripts used by CI.
- `.github/workflows/ci.yml` — reference for command style consistency and pinned bun setup.

### Dependent Files

- `.compozy/tasks/kitten-showcase-site/task_01.md` — requires scaffolded site scripts and structure.
- `.compozy/tasks/kitten-showcase-site/task_08.md` — launch docs should reflect final workflow output URL.

### Related ADRs

- [ADR-003: Keep showcase delivery as a separate Astro subproject in `site/`](../adrs/adr-003.md) — justifies separate CI path.

## Deliverables

- GitHub Pages deployment workflow for `site/dist`.
- Reproducible build/deploy chain that can be manually triggered.
- Integration validation that deploy artifacts are generated before upload.
- Unit-level check script to ensure required workflow fields exist.
- Unit test coverage target: >=80% for any added workflow validation script.

## Tests

- Unit tests:
  - [x] Workflow syntax check validates required triggers, permissions, and steps.
  - [x] `site/package.json` exposes build command used by workflow.
- Integration tests:
  - [x] Dry-run or local simulation confirms `site/dist` is uploaded to Pages artifact.
  - [x] Manual dispatch path completes without runtime prompt dependency.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80% for added verification checks
- Deployment workflow runs cleanly and produces Pages-ready artifact
- Launch workflow remains independent of terminal binary release flow
