---
status: pending
title: "First-run flow and packaging"
type: infra
complexity: medium
dependencies:
  - task_04
  - task_08
---

# Task 14: First-run flow and packaging

## Overview
Deliver the first-run experience and the distribution pipeline so a developer can install Kitten and reach a working two-agent cockpit fast.
It guides per-agent setup using readiness results and produces the compiled standalone binaries plus an npm package.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST provide a first-run flow that detects unconfigured or not-ready agents (using task_04 readiness) and tells the user exactly what is missing.
- MUST assume the current working directory is the project and require the user to be in a repo, per the PRD onboarding.
- MUST produce per-platform standalone executables via `bun build --compile` for the targets in ADR-006 (darwin-arm64, darwin-x64, linux-x64, linux-arm64).
- MUST provide a minimal, checksummed one-line curl installer and publish an npm package for `bunx kitten` (ADR-006).
- MUST keep the target under the PRD onboarding budget (time-to-first-agent-response under 60 seconds on a configured machine).
- SHOULD sequence the release after the feature tasks (through task_13) are complete, since packaging bundles the finished app.
</requirements>

## Subtasks
- [ ] 14.1 Implement the first-run flow surfacing per-agent readiness gaps and repo requirement
- [ ] 14.2 Add the `bun build --compile` build script for the four platform targets
- [ ] 14.3 Add the checksummed one-line curl installer script
- [ ] 14.4 Configure the npm package for `bunx kitten`
- [ ] 14.5 Validate each compiled artifact boots on its platform in CI
- [ ] 14.6 Cover the first-run guidance and build configuration with tests

## Implementation Details
Create the first-run flow and packaging pipeline. See PRD "User Experience → Onboarding", ADR-006 (compiled binary distribution), and ADR-005 (BYO readiness). First-run uses readiness reasons from task_04; packaging bundles the runnable app from task_08 onward.

### Relevant Files
- `src/config/firstRun.ts` — new; first-run guidance from readiness results
- `scripts/build.ts` — new; `bun build --compile` for the platform targets
- `scripts/install.sh` — new; checksummed curl installer
- `package.json` — modified; `bin` and publish configuration
- `src/config/firstRun.test.ts` — new; tests

### Dependent Files
- `.github/workflows/*` or equivalent CI — validates artifacts per platform (created here)

### Related ADRs
- [ADR-006: Distribution as a Compiled Standalone Binary](adrs/adr-006.md) — build targets and install paths
- [ADR-005: BYO Agents via Config-Driven ACP Subprocess Spawn](adrs/adr-005.md) — first-run readiness guidance

## Deliverables
- First-run guidance flow and the compiled-binary + npm distribution pipeline
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test that a built artifact boots and reaches the cockpit in a headless check **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] With one agent not-ready, first-run reports that agent's specific missing-setup reason and marks the other ready
  - [ ] Running outside a repo produces a clear "run inside a project directory" message
  - [ ] The build script enumerates exactly the four ADR-006 platform targets
  - [ ] The installer script verifies a checksum before installing (fails on mismatch)
- Integration tests:
  - [ ] A compiled artifact boots headlessly, loads config, and reaches the cockpit frame without a native crash
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- First-run clearly guides per-agent setup and the repo requirement
- Compiled binaries for the four targets and an npm package are produced and boot cleanly
