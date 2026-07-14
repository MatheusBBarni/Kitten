---
status: pending
title: Add coordinator request handles and exact timeout settlement
type: backend
complexity: high
---

# Task 03: Add coordinator request handles and exact timeout settlement

## Overview

Extend the controller’s existing interaction coordinator so a clarification exposes one captured request identity, a terminal promise, and a timeout settlement path that works while the request is active or suspended. This retains Kitten’s current generation guards and ensures racing submissions, timeouts, and lifecycle cancellation settle exactly once.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. A clarification caller MUST receive a captured request handle that exposes the identity needed for controlled timeout settlement without exposing mutable coordinator state.
- 2. Timeout, submitted, skipped, cancelled, and session-loss paths MUST settle the same request at most once across active, queued, and suspended states.
- 3. Stale-generation, duplicate, and late terminal events MUST be inert.
- 4. Existing permission preemption/resumption and sibling-session behavior MUST remain intact.
</requirements>

## Subtasks

- [ ] 3.1 Define the coordinator handle and exact-settlement contract for clarification requests.
- [ ] 3.2 Apply the fixed timeout to the accepted form across active and suspended states.
- [ ] 3.3 Preserve current session-loss cancellation and interaction resumption behavior.
- [ ] 3.4 Add race and lifecycle coverage around every terminal result.

## Implementation Details

Modify the controller-owned coordinator rather than adding request lifecycle state to the store. See the TechSpec “Core Interfaces,” “Data and Control Flow,” and “Testing Approach” sections.

### Relevant Files
- `src/app/controller.ts` — owns `createInteractionCoordinator`, generation guards, active projection, and session cancellation.
- `src/app/controller.test.ts` — contains the coordinator’s deterministic unit and integration-style test seams.

### Dependent Files
- `src/app/askUserBridge.ts` — uses the captured handle at the application boundary.
- `src/ui/ClarificationPrompt.tsx` — settles the captured request identity from the active overlay.
- `src/telemetry/recorder.ts` — receives one terminal outcome per projected clarification.

### Related ADRs
- [ADR-001: Scope the provider-independent clarification bridge as a live-generation V1](adrs/adr-001.md) — requires live-generation at-most-once settlement.
- [ADR-003: Use a controller-owned bridge with per-session authenticated local IPC](adrs/adr-003.md) — binds bridge calls to controller lifecycle ownership.
- [ADR-004: Define a bounded multi-field contract with a Kitten-owned five-minute timeout](adrs/adr-004.md) — requires timeout across queued and active form states.

## Deliverables

- A clarification request-handle API with controlled exact settlement.
- Fixed-timeout behavior integrated with preemption, resumption, and lifecycle cancellation.
- Controller tests with 80%+ coverage of changed coordinator paths.
- Integration coverage for an agent blocked on a clarification while other interactions remain usable.

## Tests

- Unit tests:
  - [ ] Submission racing the timeout resolves one submitted or timed_out outcome, never both.
  - [ ] A timeout of a suspended clarification settles that request and resumes the correct prior interaction.
  - [ ] Duplicate, stale-generation, and late timeout attempts return no-op behavior.
  - [ ] Session replacement, close, provider error, and disposal cancel outstanding requests once.
- Integration tests:
  - [ ] Two sessions can hold independent clarification work without one terminal event settling the other.
  - [ ] A preempted permission resumes after the clarification terminal outcome.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every accepted clarification has exactly one terminal outcome while its session generation is live.
- Existing approval queue ordering and session isolation remain unchanged.
