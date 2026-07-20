---
status: pending
title: "Persist installer-owned standalone provenance"
type: backend
complexity: high
---

# Task 02: Persist installer-owned standalone provenance

## Overview

Make the checksum installer establish durable ownership evidence for each successful standalone install. The record must be created only after the installer has placed a verified executable, so a later update can prove the exact target without guessing from its name or PATH.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST create or replace a canonical-path registry entry only after `scripts/install.sh` has verified the artifact checksum and successfully installed the target executable.
2. MUST record the canonical regular-file path, supported platform, embedded Kitten version, and verified lowercase SHA-256 using the TaskSpec registry model; the installer selector value `latest` MUST NOT be stored as the installed version.
3. MUST preserve unrelated installer-managed records and write the registry atomically; an atomic-write, record-validation, or record-writer failure MUST leave prior registry bytes unchanged.
4. MUST provide a private noninteractive record-writer path that is handled before Cockpit, self-check, repository, agent, or network work and validates the actual executable rather than trusting only shell input.
5. MUST leave a successfully installed executable usable when recording fails, report that it is not eligible for `--update`, and MUST NOT fabricate a provenance record.
6. MUST use only the existing portable checksum behavior and built-in runtime capabilities; no package, alternate runtime, or first-run-state schema change is allowed.
</requirements>

## Subtasks

- [ ] 2.1 Add the installer-owned provenance-record write path.
- [ ] 2.2 Validate final executable identity before accepting installer provenance.
- [ ] 2.3 Preserve atomic registry and multi-installation behavior.
- [ ] 2.4 Invoke record creation only after the installer reaches a verified target installation.
- [ ] 2.5 Surface a legible installed-but-not-update-eligible outcome when record creation fails.
- [ ] 2.6 Cover installer ordering and private record-mode boundaries.

## Implementation Details

Implement the installer/state handoff in TechSpec "System Architecture — Installer and state boundary" and "Integration Points — Standalone installer". This task establishes ownership evidence only; it does not retrieve releases, run `kitten --update`, or replace a recorded binary.

### Relevant Files

- `scripts/install.sh` — invokes provenance recording strictly after verified `install -m 755` succeeds.
- `test/install.test.ts` — existing source-based shell harness for checksum, installation-order, and failure-preservation tests.
- `src/update.ts` — extends the registry writer/validator from the standalone primitive boundary.
- `src/update.test.ts` — covers multi-record preservation, atomic failures, and final-target validation.
- `src/index.ts` — hosts the private noninteractive record-writer dispatch before normal boot.
- `test/firstRunBoot.test.ts` — verifies private record dispatch cannot reach self-check or Cockpit boot.

### Dependent Files

- `src/update.ts` — later standalone transaction logic consumes these records without repairing malformed state.
- `test/update.integration.test.ts` — later transaction fixture requires an installer-shaped valid record.

### Related ADRs

- [ADR-003: Keep Update Mutation at Its Provenance Boundary](adrs/adr-003.md) — assigns standalone ownership to installer-proven compiled binaries.
- [ADR-004: Use Canonical-Path Records and Tagged Releases for Standalone Updates](adrs/adr-004.md) — specifies registry content and canonical validation.
- [ADR-005: Prove Update Transactions with Isolated Local Tests](adrs/adr-005.md) — requires failure-preservation evidence.

## Deliverables

- Installer flow that creates standalone provenance only after successful verified installation.
- Private compiled-binary record-writer path with final executable validation.
- Shell, source, and boot-dispatch tests for every record-write outcome.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for installer record timing and preservation **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Registry writing adds or replaces one canonical-path record without deleting a preexisting second record.
  - [ ] Invalid path type, canonical mismatch, unsupported platform, invalid embedded version, and invalid hash are rejected before registry mutation.
  - [ ] A simulated atomic registry-write failure preserves the exact prior registry bytes.
  - [ ] The private record mode exits before self-check, repository validation, renderer creation, agent startup, or network activity.
- Integration tests:
  - [ ] A temporary valid artifact and `SHA256SUMS` install a runnable executable and exactly one record with canonical path, platform, embedded version, and verified hash.
  - [ ] Failed download, missing manifest entry, checksum mismatch, and failed `install` leave no new target or record and do not invoke the record writer.
  - [ ] A record-writer failure after a successful target install leaves the executable runnable, preserves prior registry bytes, and emits installed-but-not-update-eligible guidance.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every installer-managed target has verifiable canonical ownership only after a successful checksum-verified installation.
- No failed installation or record write produces a partial provenance record or alters unrelated first-run state.
