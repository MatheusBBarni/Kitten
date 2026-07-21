---
status: pending
title: Delegate Root Development Commands and CI to Cockpit
type: infra
complexity: high
---

# Task 04: Delegate Root Development Commands and CI to Cockpit

## Overview

Make the private root a stable developer and CI entrypoint that delegates Cockpit commands through Bun workspace filtering. Preserve the existing command names, exit behavior, root installation policy, README validation order, and separate showcase-site workflow.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- Root developer commands MUST delegate with `bun run --filter @matheusbbarni/kitten <script>` and preserve command names and exit behavior.
- CI MUST retain its root frozen installation and separate `site` installation behavior.
- CI’s README install resolver MUST execute before the workspace install while running the relocated Cockpit checker with an explicit root README path.
- `scripts/check-readme-install.ts` MUST relocate to Cockpit without changing its canonical public installer URL validation.
- CI MUST invoke root delegation or the same filtered Cockpit scripts, never a Cockpit source entrypoint directly.
- The workspace delegation contract MUST reject direct `src/` invocation in root aggregate scripts.
</requirements>

## Subtasks

- [ ] 4.1 Finalize root coordinator scripts for start, development, typecheck, test, coverage, self-check, and build flows.
- [ ] 4.2 Move the README install checker into Cockpit and retain its public URL validation behavior.
- [ ] 4.3 Update CI to call the relocated checker with app-local CWD before root installation.
- [ ] 4.4 Route CI typecheck and coverage through the root workspace delegates while preserving the isolated coverage command.
- [ ] 4.5 Add focused workflow and manifest assertions for delegated command shape, command order, and site isolation.

## Implementation Details

The root is a coordinator, not a second Cockpit project. The current CI contract requires README resolver validation before `bun install`, then a separate `site` installation, followed by typecheck and isolated coverage. Make app-local CWD explicit for the moved checker and retain every public README URL assertion.

### Relevant Files

- package.json — private root filtered Cockpit command delegates.
- .github/workflows/ci.yml — root CI ordering, workspace installation, and delegated validation.
- scripts/check-readme-install.ts — Cockpit-owned README resolver to relocate.
- apps/cockpit/scripts/check-readme-install.ts — relocated resolver with unchanged URL validation.
- apps/cockpit/test/ciWorkflow.test.ts — CI ordering and command contract coverage.
- apps/cockpit/test/workspaceDelegation.test.ts — new filtered-command and private-root contract coverage.
- apps/cockpit/test/tsconfig.test.ts — app-local TypeScript project contract coverage.

### Dependent Files

- bunfig.toml — root installation and coverage policy configuration.
- README.md — public installer URL read by the relocated resolver.
- site/package.json — independent showcase-site installation contract.

### Related ADRs

- [ADR-003: Make the repository root a private workspace coordinator](adrs/adr-003.md)
- [ADR-006: Move the existing Cockpit suite app-local and keep root delegation](adrs/adr-006.md)

## Deliverables

- Stable root developer commands that delegate to Cockpit through Bun filtering.
- A relocated README resolver and CI invocation with explicit app CWD and root README path.
- CI coverage that retains root install order, isolated coverage, and site separation.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration-style root command and CI workflow tests with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Each aggregate Cockpit root script uses the exact Bun filter command shape.
  - [ ] No root aggregate script invokes `src/` or `apps/cockpit/src` directly.
  - [ ] The README resolver accepts the explicit root README path and retains the canonical installer URL requirement.
  - [ ] The CI workflow keeps README validation before root frozen installation and preserves the separate site install.
- Integration tests:
  - [ ] Root typecheck and isolated coverage delegates run Cockpit commands with their expected app-local behavior.
  - [ ] Focused CI workflow and workspace delegation tests validate the completed YAML and manifest contracts.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Developers and CI retain root command entrypoints while Cockpit executes from its own package.
- CI preserves its current install, README validation, coverage, and showcase-site contracts.
