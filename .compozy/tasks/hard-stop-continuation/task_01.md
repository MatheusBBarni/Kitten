---
status: pending
title: Model the live post-interrupt continuation lifecycle
type: refactor
complexity: high
---

# Task 01: Model the live post-interrupt continuation lifecycle

## Overview

Add the protocol-free, reducer-owned state machine for exactly one post-interrupt continuation. It must be distinct from steering so a queued continuation can only become a normal user turn after the controller confirms ordinary dispatch.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. The core MUST own one generation-fenced continuation request with an explicit lifecycle, an interrupted-turn identity, and a local recovery payload.
- 2. The reducer MUST accept only valid, idempotent lifecycle transitions and MUST reject stale, duplicate, wrong-request, wrong-interrupted-turn, or generation-replaced events without changing state.
- 3. A queued continuation MUST remain live-only and MUST NOT append a user transcript turn until its ordinary dispatch is acknowledged.
- 4. Selectors MUST expose content-free phase and recovery availability, plus a single-use recovery payload for the focused composer.
- 5. The new state machine MUST NOT reuse or alter steering queue semantics.
</requirements>

## Subtasks

- [ ] 1.1 Define protocol-free continuation state, event, phase, and request contracts alongside existing session state.
- [ ] 1.2 Implement a focused pure lifecycle helper with one-slot, generation-fenced transitions and recovery ownership.
- [ ] 1.3 Route continuation events through the session reducer without changing unrelated turn or steering behavior.
- [ ] 1.4 Add stable content-free status and one-time recovery selectors.
- [ ] 1.5 Cover legal, stale, duplicate, recovery, and transcript-boundary transitions in colocated tests.

## Implementation Details

Mirror the separation of pure lifecycle helpers, reducer events, and cached selectors used by steering, but keep a dedicated continuation model. Follow the TechSpec “Core Interfaces and Data Models” and “State Machine” sections.

### Relevant Files
- `src/core/types.ts` — protocol-free session and continuation contracts.
- `src/core/postInterruptContinuation.ts` — new pure lifecycle helper.
- `src/core/postInterruptContinuation.test.ts` — new lifecycle transition coverage.
- `src/core/sessionReducer.ts` — sole reducer write path for session state.
- `src/core/sessionReducer.test.ts` — reducer acceptance and transcript-boundary coverage.
- `src/store/selectors.ts` — content-free status and focused recovery selectors.
- `src/store/selectors.test.ts` — stable selector and recovery tests.

### Dependent Files
- `src/app/actions.ts` and `src/app/controller.ts` — later controller actions and effects consume the new events.
- `src/ui/PromptEditor.tsx` — later composer work consumes only selector and action contracts.
- `src/persistence/runWriter.ts` — must continue omitting this live-only state.

### Related ADRs
- [ADR-003: Keep continuation lifecycle reducer-owned and effect coordination in the controller](adrs/adr-003.md) — defines the ownership boundary.
- [ADR-004: Require attested settlement and metadata-only persistence](adrs/adr-004.md) — prohibits continuation content from persistence.

## Deliverables

- Protocol-free continuation contracts and pure lifecycle helper.
- Reducer events plus content-free selector projections.
- Colocated lifecycle, reducer, and selector tests.

## Tests

- Unit tests:
  - [ ] Idle, queued, waiting, dispatching, recovery, delivery, and acknowledgement transitions obey the closed lifecycle.
  - [ ] Stale generations, duplicate request IDs, wrong interrupted-turn IDs, and illegal phase jumps return the existing state by identity.
  - [ ] Recovery exposes the exact blocks once and clears them only after acknowledgement.
- Integration tests:
  - [ ] A continuation never creates a transcript user turn before a delivery event.
  - [ ] Interleaved steering and continuation reducer events remain independent and preserve each lifecycle's structural sharing.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The core can represent one recoverable continuation without provider, persistence, telemetry, or UI imports.
- No continuation content becomes a transcript turn before ordinary dispatch confirmation.
