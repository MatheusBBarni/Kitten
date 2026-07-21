---
status: pending
title: Preserve Root Installer and Documentation Contract
type: docs
complexity: high
---

# Task 06: Preserve Root Installer and Documentation Contract

## Overview

Make the final root-owned installer and documentation updates required by the workspace layout, without changing public installation instructions or user-visible Cockpit behavior. Then run the full parity evidence gate across root delegation, Cockpit runtime, packaging, release, and documentation contracts.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- Root `scripts/install.sh` MUST keep the canonical immutable GitHub release-asset URL, platform mapping, checksum verification, and installed binary behavior unchanged.
- Root `README.md` MUST retain truthful public installation, usage, and release documentation while accurately describing the repository’s workspace layout where needed.
- Documentation MUST NOT advertise a user-facing Orchestrator, continuity behavior, shared package, config migration, or new Cockpit capability.
- Installer and README contract tests MUST keep validating root-owned paths from their app-local test location.
- The final parity evidence gate MUST run the repository’s full typecheck, test, self-check, build, package, release-workflow, and documentation contract checks appropriate to the changed surface.
- Any failed parity check MUST be diagnosed and fixed before the migration is presented as ready for implementation completion.
</requirements>

## Subtasks

- [ ] 6.1 Review root installer behavior against the completed Cockpit release artifact layout and retain the public URL/asset contract.
- [ ] 6.2 Update root README workspace wording only where needed, preserving all public install and usage instructions.
- [ ] 6.3 Update app-local documentation and installer tests for intentional root paths without weakening assertions.
- [ ] 6.4 Run focused installer, README, showcase, cursor-documentation, and release-asset tests.
- [ ] 6.5 Run the full Cockpit-parity verification matrix and record fresh evidence for every required surface.

## Implementation Details

The installer is a root-owned public consumer of immutable release assets. It must not learn repository-internal build paths. Documentation may identify Cockpit as the current public application, but Phase 1 remains invisible: no user-facing future Orchestrator or continuity promises. Treat every contract test as source-of-truth evidence rather than rewording it to accommodate a path regression.

### Relevant Files

- scripts/install.sh — root public installer and release-asset URL consumer.
- README.md — root public installation, usage, and repository documentation.
- apps/cockpit/test/install.test.ts — installer platform, URL, checksum, and binary contract coverage.
- apps/cockpit/test/readmeInstall.test.ts — README installation instruction contract coverage.
- apps/cockpit/test/showcaseReadme.test.ts — README/showcase documentation contract coverage.
- apps/cockpit/test/cursorDocumentation.test.ts — user-facing documentation contract coverage.
- apps/cockpit/test/showcaseSiteWorkflow.test.ts — root showcase workflow/documentation contract coverage.

### Dependent Files

- .github/workflows/release.yml — root publisher of the immutable assets consumed by the installer.
- apps/cockpit/package.json — public package identity described by documentation.
- apps/cockpit/scripts/check-readme-install.ts — canonical installer URL resolver.
- site/ — separate showcase content that must remain aligned with root documentation.

### Related ADRs

- [ADR-001: Gate the two-app migration on Cockpit parity](adrs/adr-001.md)
- [ADR-002: Keep Phase 1 invisible to users](adrs/adr-002.md)
- [ADR-004: Keep release ownership at the root while Cockpit owns build output](adrs/adr-004.md)
- [ADR-006: Move the existing Cockpit suite app-local and keep root delegation](adrs/adr-006.md)

## Deliverables

- A root installer that retains its immutable public release-asset contract.
- Root documentation that remains truthful and avoids Phase 2 promises.
- Updated app-local contract tests for every intentional root installer and documentation path.
- Fresh end-to-end parity evidence across runtime, packaging, release, installer, and documentation behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration-style installation and end-to-end parity tests with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] The installer retains all platform mappings, immutable release URL construction, checksum verification, and installed binary behavior.
  - [ ] README installation and usage instructions retain their canonical public URLs and commands.
  - [ ] Documentation contains no user-facing Orchestrator, continuity, shared-package, or state-migration promise.
  - [ ] App-local tests resolve every intentional root installer, README, workflow, and showcase path explicitly.
- Integration tests:
  - [ ] The installer consumes a released native asset through the same public path documented in the README.
  - [ ] Root delegation, Cockpit typecheck/test/self-check/build, native packaging, release workflow, and documentation contracts pass together.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The public installer and documentation remain behaviorally and textually compatible with the released Cockpit package.
- Fresh parity evidence covers the entire migrated surface with no Phase 2 behavior exposed.
