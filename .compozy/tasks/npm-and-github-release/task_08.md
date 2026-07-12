---
status: pending
title: "Atomic OIDC-provenance publish and post-publish npx smoke"
type: infra
complexity: high
dependencies:
  - task_05
  - task_06
  - task_07
---

# Task 08: Atomic OIDC-provenance publish and post-publish npx smoke

## Overview
This task completes the release train by adding the atomic npm publish to the consolidated workflow.
It publishes the four platform packages then the main shim (exact-pinned) via `npm publish --provenance` under OIDC Trusted Publishing with no static token, and adds a post-publish smoke that runs `npx kitten` on a Bun-free Node environment across all four platforms.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a `publish` job to the consolidated workflow that `needs:` all four `build` jobs (all-or-nothing) and runs only on `release_created`.
- MUST publish the four `@kitten/<slug>` platform packages first, then the main shim last, so a partial failure never leaves the shim pointing at a missing package.
- MUST publish via `npm publish --provenance` under OIDC Trusted Publishing with `id-token: write`, and MUST NOT use a static `NPM_TOKEN` in steady state (document the one-time scoped-token bootstrap).
- MUST attach the binaries + `SHA256SUMS` to the Release from the same build (kept from task_05) so both channels share one build.
- MUST add a post-publish smoke job (matrix over the four platforms) running `npx kitten@<tag> --self-check` in a Bun-free Node environment.
- MUST run publish on an image with npm CLI >= 11.5.1 / Node >= 22.14.0.
</requirements>

## Subtasks
- [ ] 8.1 Add the `publish` job gated on `release_created`, `needs:` all builds
- [ ] 8.2 Publish platform packages first, main shim last, exact-pinned
- [ ] 8.3 Switch to `npm publish --provenance` under OIDC; remove the static `NPM_TOKEN`; document the bootstrap
- [ ] 8.4 Add the post-publish `npx --self-check` smoke matrix (Bun-free)
- [ ] 8.5 Verify provenance is attached and the version matches across channels

## Implementation Details
Extend `.github/workflows/release.yml` (the workflow task_05 restructured) with the `publish` and `smoke` jobs, adding the `id-token: write` permission.
Uses the platform packages from task_06 and the shim from task_07.
See the TechSpec "Integration Points" (OIDC Trusted Publishing) and ADR-001/ADR-003.
The Node/npm version floor is in the TechSpec "Technical Dependencies".

### Relevant Files
- `.github/workflows/release.yml` - add `publish` + `smoke` jobs (the workflow from task_05)
- `package.json` - the shim published last; `publishConfig.access: public`
- `scripts/build.ts` generated platform packages (task_06) - published first

### Dependent Files
- npm registry / GitHub Release - external publish targets
- `README.md` - the `npx` channel it advertises is verified by the smoke job

### Related ADRs
- [ADR-001: V1 scope for the automated release train](../adrs/adr-001.md) - atomic ordered token-less publish + provenance
- [ADR-003: One consolidated release workflow](../adrs/adr-003.md) - OIDC without an elevated token

## Deliverables
- A `publish` job: ordered, atomic, provenance-signed, token-less
- A post-publish `npx` smoke across the four platforms
- Documented OIDC bootstrap (first scoped-token publish, then lock to trusted publishing)
- A workflow-validity test and documented acceptance **(REQUIRED where testable)**
- Test coverage >=80% on any helper/validation added **(REQUIRED where code exists)**

## Tests
- Unit tests:
  - [ ] the `publish` job `needs:` all four build jobs and carries `if: ...release_created`
  - [ ] the publish step order lists the four `@kitten/<slug>` packages before the main shim
  - [ ] the workflow declares `id-token: write` and references no `NPM_TOKEN` secret in steady state
  - [ ] the `smoke` job runs `npx kitten@<tag> --self-check` across the four platforms in a Bun-free environment
- Integration tests:
  - [ ] (CI-observable acceptance) a release publishes all five packages with a provenance attestation (verifiable via `npm audit signatures`), the post-publish smoke is green on all four platforms, and `npx kitten --version` equals the released version
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- A release publishes all five packages atomically, provenance-signed, with no static token
- `npx kitten --self-check` is green on all four platforms post-publish
- A partial failure leaves the previous version resolvable
