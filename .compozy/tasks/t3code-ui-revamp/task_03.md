---
status: pending
title: Add migration v9 and immutable review-evidence persistence
type: backend
complexity: high
---

# Task 03: Add migration v9 and immutable review-evidence persistence

## Overview

Add the durable storage and transaction seam for immutable review evidence,
evidence-bound dispositions, and queue-v2 persistence. The journal snapshot
exposes only bounded evidence summaries while patch blobs remain outside normal
projection rebuilds and revision broadcasts.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Migration version 9 MUST append to migrations 1–8 without rewriting their historical definitions.
2. `review_evidence` and `review_evidence_files` MUST enforce identity, count, ordering, foreign-key, uniqueness, and immutable update/delete constraints.
3. Migration v9 MUST replace the approval-only, one-review-per-card disposition constraint with evidence-bound repeated review-round support.
4. The persistence layer MUST provide one immediate SQLite transaction seam for evidence rows, journal references, lifecycle transitions, and dispositions.
5. Snapshot rebuild MUST expose deterministic latest evidence summaries per card and MUST NOT load patch blobs.
6. Queue-v2 persisted rows and legacy queue states MUST rebuild deterministically.
7. Exact duplicate evidence insertion SHOULD be idempotent; identity reuse with differing metadata or bytes MUST fail closed.
</requirements>

## Subtasks

- [ ] 3.1 Append the version-9 evidence, evidence-file, disposition, queue, trigger, and index migration.
- [ ] 3.2 Add validated evidence persistence and snapshot-summary types.
- [ ] 3.3 Add the narrow shared SQLite transaction seam required by lifecycle commits.
- [ ] 3.4 Rebuild deterministic latest evidence availability without loading patch content.
- [ ] 3.5 Preserve queue-v2 and disposition replay invariants.
- [ ] 3.6 Add fresh-database, v8-to-v9, rollback, immutability, and restart coverage.

## Implementation Details

Follow the TechSpec **Data Models**, **Event journal and SQLite**, and
**Compatibility and Migration** sections. Resolve the existing
`UNIQUE(card_id)` and approval-only disposition constraints inside migration 9
so repeated request-changes review rounds are representable.

### Relevant Files

- `packages/desktop/src/persistence/migrations.ts` — append-only schema and data migration.
- `packages/desktop/src/persistence/eventJournal.ts` — transaction boundary, event validation, and bounded snapshot rebuild.
- `packages/desktop/src/persistence/eventJournal.test.ts` — migration, rollback, replay, and snapshot coverage.
- `packages/desktop/src/persistence/projectionRebuilder.ts` — deterministic rebuild integration.

### Dependent Files

- `packages/desktop/src/host/reviewEvidence.ts` — persists and reads canonical evidence through the new seam.
- `packages/desktop/src/host/reviewDisposition.ts` — records repeated evidence-bound review rounds.
- `packages/desktop/src/shared/rpc.ts` — supplies the frozen evidence-summary contracts.

### Related ADRs

- [ADR-001: Adopt a T3 Code-Inspired Supervision Loop While Preserving Kitten's Workflow Model](adrs/adr-001.md) — host-owned persistence boundary.
- [ADR-002: Make Blocked Work and Evidence-Bound Review First-Class](adrs/adr-002.md) — evidence is required before review mutations.
- [ADR-004: Persist Immutable Review Evidence and Page Diffs by File](adrs/adr-004.md) — primary storage and immutability decision.

## Deliverables

- Contiguous migration v9 with immutable review-evidence and repeated-disposition support.
- Transactional persistence seam and bounded evidence snapshot summaries.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for v8 migration, atomic rollback, and restart rebuild **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Apply versions 1–9 to a fresh database and report the exact ordered migration history.
  - [ ] Upgrade a version-8 database by applying version 9 exactly once.
  - [ ] Reject update/delete operations on manifests and file rows.
  - [ ] Reject duplicate file indices/IDs, negative counts, invalid identities, and mismatched totals.
  - [ ] Accept exact idempotent evidence replay and reject conflicting identity reuse.
  - [ ] Rebuild repeated `changes_requested` and eventual `approved` review rounds for one card.
- Integration tests:
  - [ ] Roll back manifest, files, journal reference, and lifecycle mutation when any transactional write fails.
  - [ ] Reopen SQLite and select the latest summary by `created_at` then evidence ID.
  - [ ] Verify snapshots and revision broadcasts contain no patch blobs.
  - [ ] Rebuild migrated queue-v2 state with no automatic interrupted-item dispatch.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- A review-ready card can never commit without its bound evidence in the same transaction.
- Persistence supports repeated request-changes rounds without weakening append-only history.
