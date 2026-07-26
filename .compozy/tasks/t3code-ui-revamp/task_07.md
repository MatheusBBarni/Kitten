---
status: completed
title: Implement unified direct prompt submission and safe-boundary dispatch
type: backend
complexity: high
---

# Task 07: Implement unified direct prompt submission and safe-boundary dispatch

## Overview

Consolidate initial prompting and active-attempt direction into one durable
submission command. Enter becomes final authorization, active messages queue
immediately, and only the host dispatches the FIFO head at a safe ACP boundary.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. `submitCardPrompt` MUST be the single admission path for initial and composer sources.
2. A valid explicit submission MUST return admitted, queued, or a stable rejection without any second confirmation.
3. Active-attempt messages MUST persist in FIFO order before the renderer receives success.
4. Only the host-observed safe ACP turn boundary MAY dispatch a queued head.
5. Durable `commandId` identity MUST deduplicate renderer retries across process restarts.
6. Ambiguous delivery MUST become `interrupted` and MUST NOT automatically resend.
7. Attention blockers, stale identities/generations, invalid content, and unavailable lifecycle states MUST fail without queue or ACP mutation.
</requirements>

## Subtasks

- [ ] 7.1 Consolidate initial and follow-up admission into `submitCardPrompt`.
- [ ] 7.2 Persist active-attempt submissions before acknowledging them.
- [ ] 7.3 Dispatch one FIFO head at each safe host turn boundary.
- [ ] 7.4 Enforce durable idempotency, card version, attempt generation, and blocker fencing.
- [ ] 7.5 Surface interrupted delivery and explicit retry semantics.
- [ ] 7.6 Remove confirmation-oriented coordinator and RPC behavior.
- [ ] 7.7 Add coordinator, RPC, persistence, restart, and ACP integration coverage.

## Implementation Details

Follow the TechSpec **Unified prompt submission** and **Prompt submission** data
flow. Consolidate the existing partial `dispatchAcceptedDirections` path rather
than adding another dispatcher. Keep request-changes admission fail-closed until
its evidence-bound lifecycle path is implemented.

### Relevant Files

- `packages/desktop/src/attempts/attemptCoordinator.ts` — unified admission and host-owned dispatch.
- `packages/desktop/src/attempts/attemptCoordinator.test.ts` — coordinator lifecycle and idempotency coverage.
- `packages/desktop/src/host/desktopRpc.ts` — exposes `submitCardPrompt`.
- `packages/desktop/test/followUpQueue.integration.test.ts` — durable RPC-to-ACP behavior.

### Dependent Files

- `packages/desktop/src/attempts/followUpQueue.ts` — queue-v2 transitions.
- `packages/desktop/src/attempts/followUpQueue.test.ts` — state-machine contract coverage.
- `packages/desktop/src/shared/rpc.ts` — submission and stable-error contracts.

### Related ADRs

- [ADR-002: Make Blocked Work and Evidence-Bound Review First-Class](adrs/adr-002.md) — attention-blocker admission rules.
- [ADR-005: Treat Enter as Prompt Authorization and Dispatch FIFO at Safe Boundaries](adrs/adr-005.md) — primary submission decision.

## Deliverables

- Unified durable submission command with safe-boundary FIFO delivery.
- Removal of public confirmation-oriented prompt behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for RPC persistence, ACP dispatch, restart, and deduplication **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Admit an idle-card submission as a new attempt with the exact submitted message.
  - [ ] Persist a running-attempt submission as queued without calling ACP during the active turn.
  - [ ] Dispatch two submissions once each and in FIFO order at successive safe boundaries.
  - [ ] Return the prior result for duplicate `commandId` without another row or ACP call.
  - [ ] Reject empty content, attention blocker, stale card version, stale generation, and terminal state without mutation.
  - [ ] Convert ambiguous post-`dispatching` failure to `interrupted`.
  - [ ] Emit content-free outcomes without submitted text.
- Integration tests:
  - [ ] Persist the submission before returning the success RPC envelope.
  - [ ] Reopen a queued message and dispatch it only after a safe-boundary callback.
  - [ ] Deliver one ACP prompt after duplicate RPC delivery.
  - [ ] Complete the flow without `confirmQueuedFollowUp`.
  - [ ] Rebuild queued, dispatched, removed, and interrupted states identically.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Enter authorization has no second confirmation path.
- Crash and retry behavior cannot duplicate an automatically delivered prompt.
