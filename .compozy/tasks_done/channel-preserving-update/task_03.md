---
status: completed
title: "Execute fail-closed standalone updates"
type: backend
complexity: high
---

# Task 03: Execute fail-closed standalone updates

## Overview

Implement the standalone update transaction for an installer-proven executable. It must validate ownership before contacting a release source, verify the exact candidate before replacement, and restore the original executable and registry whenever a recoverable transaction step fails.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST validate a canonical regular executable against its exact registry key/path, supported platform, embedded `KITTEN_VERSION`, and current SHA-256 before release retrieval or any target mutation.
2. MUST accept only non-draft, non-prerelease stable GitHub release metadata with a valid Kitten tag and use fixed tag-scoped artifact and `SHA256SUMS` URLs; user-supplied release URLs MUST NOT be accepted.
3. MUST require exactly one well-formed checksum row for the selected host artifact and verify downloaded candidate bytes before any execution, permission change, or replacement.
4. MUST report already-current when the validated candidate version equals the embedded version and perform zero lock, temporary-file, backup, target, or registry writes.
5. MUST serialize a canonical target with a same-directory exclusive lock and use private temporary/backup artifacts, atomic replacement, atomic registry publication, and rollback that restores original target and registry bytes on every recoverable failure.
6. MUST return a nonzero safe refusal or failure without npm fallback when ownership, release, manifest, hash, lock, filesystem, or rollback evidence is inconclusive; downloaded candidate bytes MUST NOT be executed.
</requirements>

## Subtasks

- [x] 3.1 Validate installer-created ownership before release retrieval.
- [x] 3.2 Resolve and validate the latest stable release candidate.
- [x] 3.3 Verify the selected host artifact against one unambiguous manifest checksum.
- [x] 3.4 Commit standalone replacement and registry state as one recoverable transaction.
- [x] 3.5 Produce already-current, updated, refused, and failed outcomes without channel fallback.
- [x] 3.6 Exercise success, no-write, and induced rollback behavior in isolated fixtures.

## Implementation Details

Implement TechSpec "Standalone update boundary", "Release boundary", and "Transactional replacement state" in the existing outer-layer update module. Reuse the release build's artifact names and XDG convention; do not modify release workflow, Node launcher, installer flow, or public CLI dispatch in this task.

### Relevant Files

- `src/update.ts` — extends primitive contracts with standalone ownership validation and transaction behavior.
- `src/update.test.ts` — injected failure matrix for no-mutation, transaction, cleanup, and rollback branches.
- `test/update.integration.test.ts` — new temporary-directory fixture that exercises real target/registry bytes with local release responses.
- `src/version.ts` — authoritative embedded-version comparison for record validation and already-current results.
- `scripts/build.ts` — read-only source for host artifact and checksum manifest naming.
- `src/config/configWriter.ts` — reference for private same-directory atomic-write and cleanup discipline.

### Dependent Files

- `src/index.ts` — later CLI dispatch consumes the completed standalone transaction outcome.
- `test/build.integration.test.ts` — later compiled-artifact coverage verifies the safe-refusal boundary.
- `README.md` — later documentation reflects the finalized standalone outcome contract.

### Related ADRs

- [ADR-001: Preserve Verified Installation Channels with Fail-Closed Updates](adrs/adr-001.md) — requires verified ownership and replacement before mutation.
- [ADR-002: Make Every Update Outcome Self-Describing and Fail Closed](adrs/adr-002.md) — requires explicit outcomes and recovery behavior.
- [ADR-004: Use Canonical-Path Records and Tagged Releases for Standalone Updates](adrs/adr-004.md) — defines release, checksum, and transaction rules.
- [ADR-005: Prove Update Transactions with Isolated Local Tests](adrs/adr-005.md) — requires deterministic failure-preservation proof.

## Deliverables

- Standalone update transaction in `src/update.ts` with strict validation, already-current, and rollback behavior.
- Colocated unit failure matrix and isolated filesystem/release integration fixture.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests proving byte-identical failure preservation **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Missing, malformed, stale, symlink-unsafe, nonregular, version-mismatched, platform-mismatched, or hash-mismatched target records refuse before any release fetch or write seam runs.
  - [x] Draft, prerelease, malformed, missing-tag, artifact-fetch, manifest-fetch, duplicate-row, and checksum-mismatch responses leave target and registry bytes unchanged.
  - [x] Already-current returns successful standalone output without creating a lock, temporary file, backup, target write, or registry write.
  - [x] Lock acquisition, temp write/chmod, backup rename, candidate rename, registry publish, cleanup, and rollback failures each return nonzero and restore original target and registry bytes where recovery is possible.
- Integration tests:
  - [x] A temporary installer-shaped target and registry update from representative local release metadata, artifact bytes, and manifest data, then report the standalone version transition.
  - [x] Induced filesystem and registry publication failures in the temporary fixture leave the executable and registry byte-identical to their pre-update snapshots.
  - [x] The fixture performs no live HTTP, npm, credential, or candidate-binary execution.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- A valid recorded standalone executable reaches the latest stable verified artifact or reports already-current without rewriting itself.
- Every unsupported or failed standalone transaction is nonzero, channel-preserving, and byte-preserving for the original executable and registry.
