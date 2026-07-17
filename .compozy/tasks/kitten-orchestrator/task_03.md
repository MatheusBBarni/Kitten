---
status: completed
title: Relocate Cockpit Contract Suite and Preserve App Local CWD
type: test
complexity: critical
---

# Task 03: Relocate Cockpit Contract Suite and Preserve App Local CWD

## Overview

Relocate the entire Cockpit contract suite to `apps/cockpit/test` and preserve app-local test execution. Update only the assertions that intentionally read root-owned workflow, release, installer, documentation, or site assets; preserve all runtime and package assertions.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- The complete `test/` tree MUST relocate atomically to `apps/cockpit/test`, including fixtures and helpers consumed by colocated source tests.
- Cockpit test and typecheck commands MUST execute with `apps/cockpit` as the current working directory.
- Runtime, build, launcher, TypeScript, package, and configuration tests MUST continue to resolve app-local paths without semantic rewrites.
- Tests intentionally reading root workflows, release files, README content, installer scripts, or site files MUST use their new explicit root-relative paths.
- The relocated suite MUST not retain assumptions that `test/`, `src/`, `bin/`, or the Cockpit manifest are root-owned.
- The suite MUST remain a single authoritative test suite; duplicate replacement tests are out of scope.
</requirements>

## Subtasks

- [ ] 3.1 Move the full test tree, shared fixtures, and helpers into `apps/cockpit/test` in one VCS operation.
- [ ] 3.2 Preserve app-local runtime, build, launcher, package, and TypeScript import resolution.
- [ ] 3.3 Update root-owned workflow, release, README, installer, and site source URLs deliberately.
- [ ] 3.4 Add a relocation guard that executes Cockpit validation from the app directory and rejects old-root assumptions.
- [ ] 3.5 Run focused build, launcher, workflow, documentation, and configuration test groups after relocation.

## Implementation Details

The full suite move is necessary because source tests import shared helpers such as `test/fakeController`, `test/reactTui`, and `test/mockAgent` via relative paths. Retain app-local CWD: integration tests intentionally derive `src/index.ts`, repository roots, and test resources from the running application directory. Root-owned asset assertions are the only references that need deeper paths.

### Relevant Files

- test/ — complete Cockpit contract suite to relocate to `apps/cockpit/test/`.
- test/ciWorkflow.test.ts — CI workflow and package-script contract coverage with root workflow paths.
- test/releaseWorkflow.test.ts — root native release workflow contract coverage.
- test/releasePlease.test.ts — root release configuration and manifest contract coverage.
- test/readmeInstall.test.ts — root README installer contract coverage.
- test/showcaseReadme.test.ts — root README and site documentation contract coverage.
- test/showcaseSiteWorkflow.test.ts — root showcase workflow contract coverage.
- test/build.integration.test.ts — compiled Cockpit artifact contract coverage.
- test/npm-launcher.integration.test.ts — packed public launcher contract coverage.

### Dependent Files

- apps/cockpit/src/ — runtime and colocated tests whose helper imports must remain valid.
- .github/workflows/ci.yml — root CI asset read by the relocated suite.
- .github/workflows/release.yml — root release asset read by the relocated suite.
- README.md — root public documentation asset read by the relocated suite.
- site/ — root showcase asset read by the relocated suite.

### Related ADRs

- [ADR-005: Preserve Cockpit configuration and local state with no migration](adrs/adr-005.md)
- [ADR-006: Move the existing Cockpit suite app-local and keep root delegation](adrs/adr-006.md)

## Deliverables

- One relocated Cockpit test tree with all existing fixtures and helpers intact.
- Explicit root-asset source paths for workflow, release, documentation, installer, and site assertions.
- A focused app-local CWD relocation guard.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration-style build, launcher, and workflow contract tests with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Source tests continue to resolve shared `fakeController`, `reactTui`, and `mockAgent` helpers.
  - [ ] Package, build, launcher, and TypeScript tests resolve Cockpit-local files.
  - [ ] Workflow, release, README, installer, and showcase tests resolve only their intended root assets.
  - [ ] The relocation guard rejects references to the old root runtime and test locations.
- Integration tests:
  - [ ] Cockpit typecheck and test commands run successfully from `apps/cockpit`.
  - [ ] Compiled-build and packed-launcher integrations retain their existing behavior after the suite move.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Cockpit owns a single complete app-local suite with preserved working-directory behavior.
- Root asset checks remain explicit and no stale root-tree test assumption survives.
