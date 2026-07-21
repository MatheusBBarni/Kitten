---
status: pending
title: Build SQLite migrations, immutable journal, and projection rebuild
type: backend
complexity: high
---

# Task 07: Build SQLite migrations, immutable journal, and projection rebuild

## Overview

Create the desktop-host-only SQLite authority: versioned migrations, immutable
event journal, transactional projection writes, snapshots, and deterministic
rebuild. Cockpit JSON run summaries remain TUI-only reference code rather than
desktop persistence.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Only the desktop Bun host MUST open or write the SQLite database.
2. Ordered migrations MUST be transactional, record the applied version, no-op when current, and leave no partial version on failure.
3. Immutable events MUST validate event identity, actor, kind, timestamp, payload, and per-attempt monotonic sequence; duplicates MUST fail closed.
4. Each accepted event and every affected current-state projection MUST commit in one transaction before a projection delta is emitted.
5. Snapshot reads and deterministic rebuild MUST prove persisted board, stage, and card projections derive from ordered journal events.
6. The initial schema MUST support board, stage, edge, card, journal, and projection metadata without claiming later attempt recovery behavior.
</requirements>

## Subtasks

- [ ] 7.1 Create an injectable package-local SQLite factory and migration runner.
- [ ] 7.2 Define validated journal event, snapshot, and projection-delta contracts.
- [ ] 7.3 Implement atomic append, idempotency checks, and projection writes.
- [ ] 7.4 Implement deterministic rebuild and comparison-friendly reads.
- [ ] 7.5 Add migration, transaction, duplicate, and rebuild-equivalence evidence.

## Implementation Details

Follow the TechSpec Data Models and Testing Approach. Use the existing JSON
store only as a reference for strict schemas and injectable atomicity tests.

### Relevant Files

- packages/desktop/src/persistence/sqliteDatabase.ts — desktop database factory.
- packages/desktop/src/persistence/migrations.ts — ordered migration authority.
- packages/desktop/src/persistence/eventJournal.ts — immutable append interface.
- packages/desktop/src/persistence/projectionRebuilder.ts — replayed projection reconstruction.
- packages/desktop/src/persistence/eventJournal.test.ts — temporary database coverage.
- packages/tui/src/persistence/runStore.ts — TUI-only atomicity reference.

### Dependent Files

- packages/desktop/src/workflow/workflowCommands.ts — future transactional domain caller.
- packages/desktop/src/attempts/attemptCoordinator.ts — future attempt journal caller.
- packages/desktop/src/catalog/catalogProjection.ts — future catalog projection writer.

### Related ADRs

- [ADR-004: Persist desktop work as an append-only SQLite journal with projections](adrs/adr-004.md) — authoritative storage decision.
- [ADR-003: Establish the packages-only workspace before desktop delivery](adrs/adr-003.md) — host-only ownership.

## Deliverables

- Versioned host-only SQLite migration and immutable event journal.
- Transactional projections, snapshots, and deterministic rebuild.
- Temporary-database regression suite.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for append/reopen/rebuild behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Verify ordered migrations, current-version no-op, and failed-migration rollback.
  - [ ] Reject malformed events, duplicate IDs, and duplicate or non-monotonic attempt sequences.
  - [ ] Verify failed projection writes roll back their paired journal event.
- Integration tests:
  - [ ] Append, reopen, and snapshot a temporary database with deltas only after commit.
  - [ ] Replay persisted ordered events and assert rebuild equals live projections.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- No desktop projection can change without its committed journal evidence.
- Rebuild reproduces persisted board, stage, and card state exactly.
