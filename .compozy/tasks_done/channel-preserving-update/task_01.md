---
status: completed
title: "Define standalone update primitives"
type: backend
complexity: medium
---

# Task 01: Define standalone update primitives

## Overview

Create the standalone update module's stable contracts before any installer, network, or executable mutation occurs. This gives later paths one fail-closed representation for ownership records, release candidates, outcomes, and recovery text without introducing an ACP, store, UI, or package dependency.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add one outer-layer `src/update.ts` module and colocated tests without importing ACP, core, store, app, or UI concerns.
2. MUST define the versioned standalone record, canonical-path registry key, XDG registry resolver, update outcome, deterministic formatter, and injectable dependency contract described by the TechSpec "Core Interfaces" and "Data Models" sections.
3. MUST resolve `$XDG_STATE_HOME/kitten/standalone-installations.json` with the existing `~/.local/state/kitten` fallback and MUST NOT reuse or change first-run `state.json`.
4. MUST validate only supported build targets, stable `kitten-vMAJOR.MINOR.PATCH` release tags, and exactly one lowercase SHA-256 manifest row for the selected artifact; malformed, duplicate, stale, or ambiguous input MUST become a no-mutation refusal.
5. MUST format successful, already-current, refused, and failed outcomes deterministically; every refusal or failure MUST state that no change occurred and include both PRD recovery commands.
6. MUST keep filesystem, hash, path, environment, and future fetch effects injectable so this task performs no live network request or target mutation.
</requirements>

## Subtasks

- [x] 1.1 Establish the standalone record and outcome contracts referenced by the TechSpec.
- [x] 1.2 Define registry path, canonical-key, stable-tag, host-artifact, and strict-manifest validation behavior.
- [x] 1.3 Provide deterministic success and safe-refusal terminal output.
- [x] 1.4 Expose narrow injectable effect boundaries for later update work.
- [x] 1.5 Cover valid and invalid primitive inputs with colocated tests.

## Implementation Details

Create the narrow standalone-update boundary described in TechSpec "System Architecture" and "Implementation Design". Reuse the authoritative platform/artifact naming and XDG-state conventions; this task defines contracts only and does not wire the installer, CLI dispatch, download, lock, backup, or replacement flow.

### Relevant Files

- `src/update.ts` — new standalone update contracts, pure validation, state-path resolution, formatter, and injectable seams.
- `src/update.test.ts` — new colocated deterministic validation and formatter coverage.
- `src/version.ts` — supplies the embedded Kitten version contract.
- `scripts/build.ts` — supplies `BUILD_TARGETS`, `artifactName`, and the existing release manifest naming contract.
- `src/config/appState.ts` — establishes the existing XDG state fallback convention.
- `src/config/configWriter.ts` — reference for private same-directory atomic-write discipline.

### Dependent Files

- `scripts/install.sh` — will persist only records that satisfy this schema.
- `src/index.ts` — will consume the finalized standalone update outcome at the CLI boundary.
- `test/update.integration.test.ts` — will use these public contracts to exercise later transaction behavior.

### Related ADRs

- [ADR-001: Preserve Verified Installation Channels with Fail-Closed Updates](adrs/adr-001.md) — defines the positive-ownership threshold.
- [ADR-002: Make Every Update Outcome Self-Describing and Fail Closed](adrs/adr-002.md) — defines result and recovery semantics.
- [ADR-004: Use Canonical-Path Records and Tagged Releases for Standalone Updates](adrs/adr-004.md) — defines the record and release-validation model.
- [ADR-005: Prove Update Transactions with Isolated Local Tests](adrs/adr-005.md) — requires injectable, deterministic evidence.

## Deliverables

- `src/update.ts` with the standalone primitive contracts, validators, and formatter.
- `src/update.test.ts` proving accepted and fail-closed primitive behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Temporary-XDG registry boundary test with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] `$XDG_STATE_HOME=/state` resolves the standalone registry under `/state/kitten`, while an unset value falls back under `.local/state/kitten`.
  - [x] Canonical-path keys are deterministic and reject mismatched keys, unknown schemas, unsupported platforms, non-semver versions, and malformed or uppercase SHA-256 values.
  - [x] Stable-tag validation accepts `kitten-v1.2.3` and rejects missing prefixes, incomplete versions, prereleases, whitespace, suffixes, drafts, and prerelease metadata.
  - [x] Manifest validation accepts one exact lowercase 64-hex checksum row for the selected artifact and rejects missing, duplicate, tab-separated, one-space, traversal, and malformed rows.
  - [x] Updated, already-current, refused, and failed output includes the required channel/version or no-change wording; refusals include both literal recovery commands.
  - [x] Invalid record, tag, and manifest inputs call no injected fetch, write, rename, or replacement seam.
- Integration tests:
  - [x] A temporary XDG registry containing one valid record loads through the public module boundary, while a malformed or stale sibling remains byte-for-byte unchanged.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The primitive module accepts only unambiguous standalone ownership and release data.
- Every invalid primitive result is a deterministic no-mutation outcome with copyable recovery guidance.
