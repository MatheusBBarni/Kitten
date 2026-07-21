---
status: pending
title: Persist normalized ACP activity and expose inspector/transcript projections
type: backend
complexity: high
---

# Task 12: Persist normalized ACP activity and expose inspector/transcript projections

## Overview

Persist validated normalized agent activity exactly once and derive durable,
chronological inspector/transcript projections. The typed host exposes these
projections to the renderer only after their event and projection transaction
has committed.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Accepted activity MUST be protocol-free, validated, bound to known attempt/generation, and reject stale, duplicate, malformed, post-terminal, or non-monotonic input without mutation.
2. Accepted activity MUST append exactly once to the immutable journal and update a deterministic inspector/transcript projection atomically.
3. Transcript projections MUST preserve chronological agent, user, tool, activity, terminal, and immutable Run Context evidence with deterministic chunk coalescing.
4. Typed inspector queries and messages MUST contain projections and opaque IDs only, never database handles, ACP wire objects, credentials, worktree paths, or renderer mutations.
5. This task MUST NOT add cancellation steering, ordinary follow-up confirmation, or scoped blocker persistence.
</requirements>

## Subtasks

- [ ] 12.1 Define validated attempt-activity envelope and sequence policy.
- [ ] 12.2 Bind Direct ACP activity subscription to attempt ID and generation.
- [ ] 12.3 Append accepted activity and update inspector/transcript projections atomically.
- [ ] 12.4 Publish typed inspector query and committed-activity messages.
- [ ] 12.5 Add replay, stale, duplicate, terminal, and RPC evidence.

## Implementation Details

Follow the TechSpec attempt-event journal and Persistent Card Inspector mapping.
Use existing transcript projection only as a shape precedent, not as desktop
durable authority.

### Relevant Files

- packages/desktop/src/attempts/activityIngestor.ts — validated activity entry.
- packages/desktop/src/attempts/inspectorProjection.ts — durable transcript projection.
- packages/desktop/src/host/desktopRpc.ts — typed inspector query/message registration.
- packages/desktop/src/attempts/activityIngestor.test.ts — rejection coverage.
- packages/desktop/src/attempts/inspectorProjection.test.ts — projection/rebuild coverage.
- packages/desktop/test/attempt-inspector.integration.test.ts — fake ACP and SQLite evidence.

### Dependent Files

- packages/engine/src/contracts.ts — normalized activity contracts.
- packages/desktop/src/persistence/eventJournal.ts — append/projection transaction seam.
- packages/tui/src/core/transcriptProjection.ts — reference-only existing projection shape.

### Related ADRs

- [ADR-004: Persist desktop work as an append-only SQLite journal with projections](adrs/adr-004.md) — transcript evidence authority.
- [ADR-005: Own queued follow-ups and Attention Blockers in the desktop attempt coordinator](adrs/adr-005.md) — explicit later queue/blocker boundary.

## Deliverables

- Validated normalized activity ingestion and durable inspector projection.
- Projection-only typed inspector query/message contract.
- Replay, stale, duplicate, and terminal regression suite.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for fake ACP, SQLite replay, and RPC safety **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Reject duplicate event ID, sequence gap/regression, stale generation, malformed payload, and post-terminal activity without a journal/projection change.
  - [ ] Coalesce chunks and tool updates into one chronological transcript with a correct terminal outcome.
  - [ ] Prove linked Run Context remains immutable during projection rebuild.
- Integration tests:
  - [ ] Assert event commit precedes typed activity/projection notification.
  - [ ] Rebuild after reopen and compare inspector history to the live projection.
  - [ ] Verify one attempt cannot appear in another card inspector or expose privileged handles.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every accepted desktop activity event has one durable chronological inspector record.
- Stale, duplicate, and post-terminal activity cannot alter history.
