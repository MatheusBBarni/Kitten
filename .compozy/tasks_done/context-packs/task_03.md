---
status: completed
title: Strict Context Pack persistence
type: backend
complexity: high
---

# Task 03: Strict Context Pack persistence

## Overview

Extend persisted run records with a strict session-keyed Context Pack projection that retains only draft manifests and exact sealed redacted payloads, never live authority or raw materialized source.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- Persistence MUST use an explicit allowlisted V4 Context Pack schema and migrate accepted V1–V3 records safely.
- A draft manifest MUST contain metadata only; raw source, review candidates, bridge routes, attestation, profile, reservation, and provider errors MUST be rejected.
- A sealed payload MUST retain exact redacted bytes, byte count, revision, and seal timestamp without normalization or re-redaction.
- Restoration MUST recreate no build binding or review candidate, mark restored drafts for revalidation, and reject malformed projections with bounded diagnostics.
- Existing owner-only atomic write and file-mode guarantees MUST remain intact.
</requirements>

## Subtasks

- [x] 3.1 Define V4 persisted Context Pack manifests and strict parser/serializer schemas.
- [x] 3.2 Add compatible record migration and session-keyed projection encoding.
- [x] 3.3 Persist exact sealed bytes without a second redaction or text transformation.
- [x] 3.4 Restore safe draft and sealed state while clearing all live authority.
- [x] 3.5 Add schema-negative, migration, and atomic-store coverage.

## Implementation Details

Follow the TechSpec persisted RunRecord model and restoration rules. Keep validation close to the serialization boundary and make the controller/store commit the sanitized value rather than allowing a persistence reader to reconstruct runtime authority.

### Relevant Files

- src/persistence/runRecord.ts — V4 record contracts, strict schemas, and migrations.
- src/persistence/runRecord.test.ts — migration and rejection coverage.
- src/persistence/runStore.ts — owner-only restore/store boundary.
- src/persistence/runStore.test.ts — atomic persistence behavior.
- src/persistence/runWriter.ts — existing write projection and permissions.
- src/persistence/runWriter.test.ts — exact-byte write assertions.
- src/app/controller.test.ts — restoration handoff coverage.

### Dependent Files

- src/store/appStore.ts — safe projection commit target.
- src/core/contextPack.ts — manifest restoration and revalidation result.
- src/app/controller.ts — current-run restoration boundary.

### Related ADRs

- [ADR-001: Plan the full Context Packs contract with evidence-gated vertical delivery](adrs/adr-001.md)
- [ADR-003: Keep Context Packs session-keyed and persist only manifests plus sealed bytes](adrs/adr-003.md)

## Deliverables

- Strict V4 persisted Context Pack projection and backward-compatible migration.
- Exact sealed-byte retention and metadata-only draft manifests.
- Safe restoration that clears all live builder/review authority.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for restart and malformed-record handling with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Accepted V1–V3 records migrate while a V4 record includes only allowlisted Context Pack keys.
  - [x] Raw materialized source, candidate bytes, routes, profile evidence, and arbitrary extra fields are rejected.
  - [x] Persisted sealed payload bytes round-trip exactly without normalization or redaction changes.
  - [x] Restored drafts require revalidation and never carry a review candidate or build binding.
- Integration tests:
  - [x] An atomic run-store restart restores one session's manifest and sealed value while a malformed sibling projection is dropped safely.
  - [x] Existing file mode and atomic replacement guarantees remain true for records containing Context Pack data.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Persistence retains only permitted durable custody data.
- Restart cannot restore child authority, raw source, or a falsely current review candidate.
