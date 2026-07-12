---
status: pending
title: "Consolidated release workflow: cut, native build matrix, Release assets"
type: infra
complexity: high
dependencies:
  - task_03
---

# Task 05: Consolidated release workflow: cut, native build matrix, Release assets

## Overview
Today's `release.yml` only reacts to a manually published Release, and a Release created by the default `GITHUB_TOKEN` cannot trigger a separate workflow.
This task restructures it into one consolidated workflow where release-please cuts the release on merge and, gated on `release_created`, the four native targets build and attach their binaries + `SHA256SUMS` to the Release - delivering the Phase-1 one-action cut without yet touching npm.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST restructure `.github/workflows/release.yml` into a `release_please` job (on push to `main`), a `build` matrix gated on `release_created`, and a Release-asset attach step.
- MUST build each of the four targets on its native runner (reusing `scripts/build.ts` and the existing runner matrix) and self-check each artifact before attaching it.
- MUST attach the `kitten-<slug>` binaries and the combined `SHA256SUMS` to the Release created by release-please.
- MUST gate all build/attach jobs on `needs.release_please.outputs.release_created == 'true'` so ordinary pushes no-op.
- MUST NOT introduce an elevated token; permissions limited to `contents: write` (plus `id-token: write` reserved for task_08).
- MUST keep a guarded `workflow_dispatch` fallback that cannot double-publish an existing tag.
- npm publishing is out of scope here; it is added in task_08.
</requirements>

## Subtasks
- [ ] 5.1 Add the `release_please` job emitting `release_created`/`tag_name`
- [ ] 5.2 Gate the native `build` matrix on `release_created`, reusing `build.ts` + `--self-check`
- [ ] 5.3 Attach `kitten-<slug>` binaries + `SHA256SUMS` to the Release
- [ ] 5.4 Add a guarded `workflow_dispatch` fallback
- [ ] 5.5 Verify ordinary pushes run only `release_please` and publish nothing

## Implementation Details
Restructure `.github/workflows/release.yml` (currently `on: release: published` with `build`, `publish-binaries`, `publish-npm` jobs).
See the TechSpec "System Architecture" (consolidated workflow) and ADR-003 for the job graph and the `GITHUB_TOKEN` trigger rationale.
Reuse `scripts/build.ts` (`buildAll`, per-platform native runners) and the existing self-check gate unchanged.
Depends on task_03's release-please config.

### Relevant Files
- `.github/workflows/release.yml` - restructured (current: 4-platform matrix + `publish-binaries` + `publish-npm`)
- `scripts/build.ts` - reused unchanged for the compile step
- `release-please-config.json` / `.release-please-manifest.json` - the cut config (task_03)

### Dependent Files
- `.github/workflows/release.yml` - task_08 adds the atomic npm publish job to this same workflow
- `scripts/build.ts` - task_06 adds platform-package generation the build job will invoke

### Related ADRs
- [ADR-003: One consolidated release workflow driven by release-please outputs](../adrs/adr-003.md) - primary
- [ADR-001: V1 scope for the automated release train](../adrs/adr-001.md) - release-please as the cut

## Deliverables
- Restructured release workflow that cuts the release and attaches binaries/checksums
- release-please job wired to the config
- A guarded `workflow_dispatch` fallback
- A workflow-validity test and documented acceptance **(REQUIRED where testable)**
- Test coverage >=80% on any helper/validation added **(REQUIRED where code exists)**

## Tests
- Unit tests:
  - [ ] `release.yml` parses as valid YAML; the `build`/attach jobs carry `if: needs.release_please.outputs.release_created == 'true'`
  - [ ] the build matrix lists the four platform/runner pairs matching `BUILD_TARGETS`
  - [ ] permissions declare `contents: write` and no PAT/App-token secret is referenced
- Integration tests:
  - [ ] (CI-observable acceptance) merging a release PR produces a Release carrying four `kitten-<slug>` assets + `SHA256SUMS`; an ordinary push to `main` runs only `release_please` and publishes nothing
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Merging the release PR cuts the tag + Release and attaches all four binaries + `SHA256SUMS`
- Ordinary pushes to `main` publish nothing
- No elevated/long-lived token is introduced
