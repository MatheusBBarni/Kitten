---
status: pending
title: Bridge Root Release Orchestration to Cockpit Artifacts
type: infra
complexity: critical
---

# Task 05: Bridge Root Release Orchestration to Cockpit Artifacts

## Overview

Keep the root release process authoritative while making it build, stage, validate, attach, and publish Cockpit-owned artifacts. All public package names, version/tag behavior, native asset names, install URLs, provenance checks, and Bun-free npm smoke behavior remain exactly compatible.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- `.github/workflows/release.yml` MUST retain its release-please, build, attach, publish, and smoke stages; permissions; recovery behavior; four native runners; provenance audit; and Bun-free smoke check.
- Native build, self-check, checksum, upload, package-version, optional-platform-pin rewrite, and publish paths MUST consume `apps/cockpit` artifacts coherently.
- Public release assets MUST retain the exact `kitten-{darwin-arm64,darwin-x64,linux-x64,linux-arm64}` names and `SHA256SUMS` contract.
- The public `@matheusbbarni/kitten` package and four native package identities MUST remain unchanged.
- Release Please configuration and manifest ownership MUST point at Cockpit’s package path while retaining `kitten-v<semver>` tag and version behavior.
- The release bridge MUST NOT alter the root installer’s immutable public release-asset URL contract.
</requirements>

## Subtasks

- [ ] 5.1 Redirect root release build and self-check steps to Cockpit-local execution and outputs.
- [ ] 5.2 Align checksum, staging, upload, and native package extraction paths with the Cockpit artifact layout.
- [ ] 5.3 Update publish validation, platform-pin rewriting, and npm publish working directory for the Cockpit public manifest.
- [ ] 5.4 Update Release Please package ownership and extra-file paths while retaining tag/version semantics.
- [ ] 5.5 Extend release workflow, Release Please, build, package-shim, and npm-launcher contract tests.

## Implementation Details

Keep the root workflow’s stage sequence intact. `apps/cockpit/scripts/build.ts` naturally emits `apps/cockpit/dist` when run from the app directory and stages platform packages beneath `dist/npm/@matheusbbarni`. The workflow producer and consumer locations must change as one coherent release layout, with no public artifact renaming.

### Relevant Files

- .github/workflows/release.yml — root release coordinator and native publish pipeline.
- release-please-config.json — Cockpit public package release configuration.
- .release-please-manifest.json — Cockpit public package version manifest.
- apps/cockpit/package.json — public version, platform pin, and publish directory contract.
- apps/cockpit/scripts/build.ts — app-local compiled artifact and native package staging.
- apps/cockpit/test/releaseWorkflow.test.ts — release pipeline contract coverage.
- apps/cockpit/test/releasePlease.test.ts — package mapping, tag, manifest, and pin contract coverage.
- apps/cockpit/test/build.integration.test.ts — real compiled artifact coverage.
- apps/cockpit/test/npm-launcher.integration.test.ts — packed npm launcher smoke coverage.

### Dependent Files

- scripts/install.sh — immutable public release-asset consumer retained at the root.
- README.md — public install documentation retained at the root.
- apps/cockpit/test/package-shim.test.ts — public package identity and bin contract coverage.

### Related ADRs

- [ADR-001: Gate the two-app migration on Cockpit parity](adrs/adr-001.md)
- [ADR-004: Keep release ownership at the root while Cockpit owns build output](adrs/adr-004.md)
- [ADR-006: Move the existing Cockpit suite app-local and keep root delegation](adrs/adr-006.md)

## Deliverables

- A root-owned release workflow consuming Cockpit-local native artifacts and public package files.
- Release Please configuration that versions Cockpit without changing the public release/tag contract.
- Preserved artifact names, package identities, provenance checks, and Bun-free npm smoke behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration-style native artifact, package, and release workflow tests with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Release workflow assertions preserve stage order, permissions, recovery, runners, assets, provenance, and smoke gates.
  - [ ] Build, self-check, staging, checksums, uploads, version reads, platform-pin rewrites, and publish paths target Cockpit-local artifacts.
  - [ ] Release Please maps only Cockpit’s package path and retains the `kitten-v<semver>` tag/version contract.
  - [ ] Public package and platform package names remain byte-for-byte unchanged.
- Integration tests:
  - [ ] A real Cockpit native build stages all four platform package layouts and self-checks successfully.
  - [ ] A packed Cockpit public package completes the npm launcher smoke path without Bun at runtime.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Root release orchestration publishes Cockpit output without changing any public release surface.
- Native assets, package identity, tag/version behavior, provenance, and npm smoke guarantees remain intact.
