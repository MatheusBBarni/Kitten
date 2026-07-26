---
status: pending
title: Derive the cross-project supervision projection and host query
type: backend
complexity: high
---

# Task 05: Derive the cross-project supervision projection and host query

## Overview

Add one deterministic host-derived view of actionable work across all boards and
repositories. The projection uses one authoritative snapshot per request,
retains Kitten lifecycle semantics, and carries only bounded summaries needed by
the Work Inbox.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. The host MUST derive exactly one supervision item per card from one current persistence snapshot.
2. Group priority MUST be `needs_attention`, `ready_for_review`, failed, running, then other settled work.
3. Within each group, items MUST sort by descending actionable timestamp, ascending board ID, then ascending card ID.
4. Attention, latest attempt/generation, and latest valid evidence selection MUST use durable identity and ordering rules rather than incidental array order.
5. `getSupervision` MUST expose the exact source revision and MUST NOT perform per-board N+1 queries or persist a materialized supervision table.
6. The projection MUST exclude prompts, transcripts, patches, paths, secrets, and host-only capabilities.
7. A deterministic 10,000-card fixture SHOULD meet the TechSpec p95-under-50-ms local target.
</requirements>

## Subtasks

- [ ] 5.1 Derive one bounded supervision item from each authoritative card.
- [ ] 5.2 Classify and group cards using host-owned lifecycle state.
- [ ] 5.3 Apply fixed priority, timestamp, and stable-identity ordering.
- [ ] 5.4 Attach latest valid attempt, attention, and evidence summaries.
- [ ] 5.5 Expose the revisioned host query through the desktop bridge.
- [ ] 5.6 Add determinism, privacy-boundary, refresh, and performance coverage.

## Implementation Details

Follow the TechSpec **Supervision projection**, **Supervision Ordering**, and
**Supervision read** sections. Extend the existing board RPC projection seam;
do not reproduce this logic in React, Zustand, or a new persistence table.

### Relevant Files

- `packages/desktop/src/host/boardRpc.ts` — pure `projectSupervision` derivation and host query.
- `packages/desktop/src/host/boardRpc.test.ts` — ordering, selection, payload, and performance tests.
- `packages/desktop/src/host/electrobunWindow.ts` — typed query registration.
- `packages/desktop/src/host/electrobunWindow.test.ts` — bridge and plain-JSON response coverage.

### Dependent Files

- `packages/desktop/src/persistence/eventJournal.ts` — authoritative snapshot and revision.
- `packages/desktop/src/shared/rpc.ts` — frozen supervision envelope.
- `packages/desktop/src/host/desktopCoordinator.ts` — supplies journal-backed host services.

### Related ADRs

- [ADR-001: Adopt a T3 Code-Inspired Supervision Loop While Preserving Kitten's Workflow Model](adrs/adr-001.md) — supervision complements the Kanban model.
- [ADR-002: Make Blocked Work and Evidence-Bound Review First-Class](adrs/adr-002.md) — fixed actionable priority.
- [ADR-003: Derive Supervision on Read and Keep Navigation Renderer-Local](adrs/adr-003.md) — primary projection decision.

## Deliverables

- Deterministic revisioned supervision projection and host query.
- Ordering, data-minimization, refresh, and scale regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for journal-to-Electrobun query behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Return deterministic empty groups and zero counts for an empty snapshot.
  - [ ] Let active attention override review, failure, running, and settled classification.
  - [ ] Select the latest relevant attempt/generation and latest valid evidence summary.
  - [ ] Break equal timestamps by ascending board ID and card ID.
  - [ ] Emit each card exactly once and keep counts equal to group item totals.
  - [ ] Exclude all content and privileged fields from the projection.
  - [ ] Meet the local projection target with a deterministic 10,000-card fixture.
- Integration tests:
  - [ ] Return one internally consistent snapshot revision for each query.
  - [ ] Reflect attempt, attention, evidence, and card journal changes on the next query.
  - [ ] Register `getSupervision` through Electrobun and return a valid plain-JSON envelope.
  - [ ] Avoid per-board reads for populated and empty workspaces.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Work Inbox ordering has one authoritative host implementation.
- Repeated reads of unchanged state return structurally identical output.
