---
status: pending
title: Replace confirmation queue states with authorized FIFO queue-v2 and recovery
type: backend
complexity: high
---

# Task 02: Replace confirmation queue states with authorized FIFO queue-v2 and recovery

## Overview

Replace the confirmation-oriented follow-up state model with a durable
authorization and recovery model. Explicitly submitted messages retain FIFO
order, ambiguous delivery becomes visible `interrupted` state, and restart
never silently retries uncertain work.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Queue-v2 draft states MUST be `queued`, `dispatching`, `dispatched`, `removed`, and `interrupted`.
2. Legacy explicitly submitted unsent entries MUST migrate to `queued`; ambiguous confirmed or in-flight entries MUST migrate to `interrupted`.
3. Only the FIFO head MAY enter `dispatching`, and interrupted entries MUST NOT automatically retry.
4. Queue parsing and replay MUST preserve attempt identity, generation fencing, durable order, version monotonicity, and idempotency identity.
5. Recovery MUST convert unresolved delivery uncertainty to content-free, user-visible interruption state.
6. This task MUST NOT claim universal mid-turn injection or retain a second confirmation requirement.
</requirements>

## Subtasks

- [ ] 2.1 Replace legacy draft and turn states with the queue-v2 state vocabulary.
- [ ] 2.2 Define deterministic legacy-to-v2 recovery mapping.
- [ ] 2.3 Enforce FIFO head, transition, version, removal, and interruption invariants.
- [ ] 2.4 Reconcile unresolved dispatch state during startup recovery.
- [ ] 2.5 Preserve deterministic serialization and projection replay.
- [ ] 2.6 Add focused domain and recovery regression coverage.

## Implementation Details

Follow the TechSpec **Follow-up submission schema version 2** and **Prompt
submission** data flow. Keep this task focused on durable queue semantics and
recovery; coordinator-owned ACP delivery and public RPC replacement are covered
by later integration work.

### Relevant Files

- `packages/desktop/src/attempts/followUpQueue.ts` — queue-v2 types, transitions, invariants, and serialization.
- `packages/desktop/src/attempts/followUpQueue.test.ts` — pure state-machine and migration coverage.
- `packages/desktop/src/host/recovery.ts` — startup reconciliation for ambiguous dispatch state.
- `packages/desktop/src/host/recovery.test.ts` — restart and interruption recovery coverage.

### Dependent Files

- `packages/desktop/src/persistence/migrations.ts` — persists the queue-v2 schema/data migration.
- `packages/desktop/src/persistence/eventJournal.ts` — validates and rebuilds durable queue projections.
- `packages/desktop/test/followUpQueue.integration.test.ts` — exercises queue recovery across persistence and ACP boundaries.

### Related ADRs

- [ADR-002: Make Blocked Work and Evidence-Bound Review First-Class](adrs/adr-002.md) — attention continues to block ordinary submission.
- [ADR-005: Treat Enter as Prompt Authorization and Dispatch FIFO at Safe Boundaries](adrs/adr-005.md) — queue-v2 authorization and interruption rules.

## Deliverables

- Queue-v2 state model, parser, invariants, and deterministic recovery mapping.
- Startup recovery for ambiguous dispatch state without automatic resend.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for persisted FIFO and restart recovery **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Convert legacy `queued` and explicitly authorized `awaiting_confirmation` entries to FIFO `queued`.
  - [ ] Convert legacy `confirmed` and unresolved in-flight entries to `interrupted`.
  - [ ] Permit only the FIFO head to enter `dispatching`.
  - [ ] Reject stale queue versions, stale attempt generations, and removal/dispatch races.
  - [ ] Restore an unresolved dispatch as `interrupted` and never promote it automatically.
  - [ ] Rebuild the same queue states, order, and version from immutable events.
- Integration tests:
  - [ ] Reopen a persisted multi-item queue and preserve its original FIFO order.
  - [ ] Restart from ambiguous delivery state and perform zero automatic sends.
  - [ ] Explicitly remove or retry an interrupted item without mutating unrelated entries.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- No durable state requires a second confirmation after explicit submission.
- Crash ambiguity is visible and never produces an automatic duplicate prompt.
