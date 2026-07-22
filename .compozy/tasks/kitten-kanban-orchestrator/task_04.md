---
status: completed
title: Rebase CLI, CI, release, installer, and docs on packages/tui
type: infra
complexity: high
---

# Task 04: Rebase CLI, CI, release, installer, and docs on packages/tui

## Overview

Rebase every public Cockpit delivery contract on the package-local application
while preserving the published package name and user-facing commands. This
removes the final migration bridges and makes release automation prove the
packages-only architecture.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. The public package identity, kitten command, artifact names, tags, installer URL, update safety, and provenance behavior MUST remain unchanged.
2. CI and release workflows MUST deliberately invoke package-local Cockpit paths while preserving independent site setup.
3. Release-please metadata, native build staging, package publication, checksum, and launcher smoke contracts MUST target packages/tui.
4. README and delivery-contract tests MUST describe unchanged public commands without obsolete root application paths.
5. Final public-delivery bridges MUST be removed only after package-local delivery evidence succeeds.
</requirements>

## Subtasks

- [x] 4.1 Finalize workspace-only and package-local public metadata ownership.
- [x] 4.2 Rebase CI validation commands to the TUI package.
- [x] 4.3 Re-scope release-please, workflow, build, and publication metadata.
- [x] 4.4 Rebase installer, launcher, checksum, and provenance delivery paths.
- [x] 4.5 Update README and release documentation.
- [x] 4.6 Run delivery contracts and remove the final compatibility bridges.

## Implementation Details

Follow the TechSpec Impact Analysis and staged build order. Preserve release
behavior; do not use this migration work to expand desktop product scope.

### Relevant Files

- package.json and bun.lock — workspace coordinator and resolution policy.
- packages/tui/package.json — published package and runtime metadata.
- packages/tui/scripts/ and packages/tui/bin/ — build and CLI delivery surface.
- .github/workflows/ci.yml and .github/workflows/release.yml — package-local delivery gates.
- release-please-config.json and .release-please-manifest.json — release ownership.
- README.md — public installation and command contract.
- packages/tui/test/build*, ciWorkflow*, release*, install*, launcher* — delivery regression suites.

### Dependent Files

- scripts/install.sh — installer source and provenance behavior.
- packages/tui/test/readmeInstall.test.ts — docs/install contract.
- packages/tui/test/npm-launcher.integration.test.ts — packed npm smoke proof.

### Related ADRs

- [ADR-003: Establish the packages-only workspace before desktop delivery](adrs/adr-003.md) — public ownership target.
- [ADR-007: Stage the Cockpit workspace relocation behind compatibility gates](adrs/adr-007.md) — final removal gate.

## Deliverables

- Package-local public delivery, release, installer, and documentation paths.
- Preserved native artifact, checksum, provenance, and npm shim contracts.
- Removed final public-delivery compatibility bridges.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for packed, installed, and compiled delivery paths **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Assert CI and release workflows reference package-local commands and preserve the native matrix.
  - [x] Assert release-please and README paths target the TUI package.
  - [x] Preserve build, installer, launcher, and package-shim contract branches.
- Integration tests:
  - [x] Run compiled artifact self-check, version, help, and safe update-refusal checks.
  - [x] Install a packed local npm package under Node without Bun.
  - [x] Verify installer checksum and provenance behavior.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Published Cockpit commands remain compatible from packages/tui.
- CI and release contain no obsolete root application path.
