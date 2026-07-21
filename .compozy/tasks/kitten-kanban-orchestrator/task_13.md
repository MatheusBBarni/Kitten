---
status: pending
title: Add confirmable, non-cancelling follow-up queue
type: backend
complexity: high
---

# Task 13: Add confirmable, non-cancelling follow-up queue

## Overview

Create the desktop-owned durable FIFO queue for ordinary follow-ups during a
live attempt. It never cancels the active turn; after normal settlement it
surfaces only the queue head for explicit operator confirmation.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. FIFO drafts and their create, remove, confirm, and dispatch states MUST be persisted as immutable evidence and reconstructed in projections.
2. Queueing MUST NOT cancel, fork, duplicate, or otherwise modify an active ACP turn.
3. A normal terminal turn MUST expose only the FIFO head as awaiting_confirmation and MUST NOT dispatch it automatically.
4. Confirmation MUST fence expected version, attempt, generation, and queue-head identity and dispatch exactly one prompt in the same healthy attempt.
5. An active Attention Blocker MUST prevent ordinary follow-up dispatch while retaining the queue unchanged.
6. Stale, invalid-state, and conflict outcomes MUST be typed and local telemetry MUST remain content-free.
</requirements>

## Subtasks

- [ ] 13.1 Define durable queue identity, events, states, and projection validation.
- [ ] 13.2 Implement transactional enqueue, removal, FIFO ordering, and version-fenced reads.
- [ ] 13.3 Surface only the head for explicit confirmation after normal settlement.
- [ ] 13.4 Dispatch one confirmed head without any cancellation path.
- [ ] 13.5 Expose typed host operations and add persistence/ACP-boundary coverage.

## Implementation Details

Follow the TechSpec Persistent Card Inspector and Composer flow. Existing
Cockpit steering is cancellation-oriented reference code and must not supply
desktop follow-up behavior.

### Relevant Files

- packages/desktop/src/attempts/followUpQueue.ts — durable queue state machine.
- packages/desktop/src/attempts/followUpQueue.test.ts — queue domain coverage.
- packages/desktop/src/attempts/attemptCoordinator.ts — same-attempt dispatch boundary.
- packages/desktop/src/attempts/attemptCoordinator.test.ts — non-cancellation evidence.
- packages/desktop/src/host/desktopRpc.ts — typed queue command surface.
- packages/desktop/test/followUpQueue.integration.test.ts — journal and fake-ACP evidence.

### Dependent Files

- packages/desktop/src/attention/attentionCoordinator.ts — future active-blocker gate.
- packages/tui/src/core/steering.ts — reference-only cancellation contrast.
- packages/tui/src/app/steeringCoordinator.ts — reference-only old steering owner.

### Related ADRs

- [ADR-001: Constrain V1 to a linear governed workflow with queued active-run input](adrs/adr-001.md) — queue baseline.
- [ADR-005: Own queued follow-ups and Attention Blockers in the desktop attempt coordinator](adrs/adr-005.md) — explicit confirmation ownership.
- [ADR-004: Persist desktop work as an append-only SQLite journal with projections](adrs/adr-004.md) — queue evidence authority.

## Deliverables

- Durable, FIFO, confirmable follow-up queue with typed host commands.
- No-cancellation and head-only dispatch contract.
- Temporary SQLite and fake-ACP regression suite.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for queue lifecycle and confirmation behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Verify FIFO order, head-only confirmation, removal, and rebuild equality.
  - [ ] Reject duplicate, stale, out-of-order, terminal, errored, and cancelled confirmation.
  - [ ] Reject confirmation while a blocker is active without changing drafts.
- Integration tests:
  - [ ] Queue during an active turn and assert zero ACP cancellation calls and zero automatic sends.
  - [ ] Settle normally and assert explicit confirmation sends exactly once in the same attempt.
  - [ ] Verify typed RPC conflict/result behavior.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- No ordinary active-run follow-up silently interrupts or dispatches.
- Every sent queued follow-up has explicit committed confirmation evidence.
