---
status: completed
title: Core Steering Lifecycle
type: refactor
complexity: high
---

# Task 01: Core Steering Lifecycle

## Overview

Define the reducer-owned, protocol-free lifecycle that makes an accepted steering request ordered, generation-safe, and recoverable. This provides one authoritative source for phases and raw recovery data before any controller, ACP, or UI work can act on it.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. The steering domain model MUST remain pure and protocol-free: it must not import ACP types, transport code, React, I/O, timers, or promises.
- 2. `SessionState` MUST own an initialized `SteeringState` with active-turn identity, ordered request queue, closed phase vocabulary, and one recoverable terminal payload.
- 3. Steering transitions MUST validate request identity and generation for every asynchronous settlement; invalid, stale, or duplicate events MUST return the existing state reference.
- 4. Ordered queued blocks MUST coalesce only at confirmed delivery into one normal user transcript turn; steering events themselves MUST NOT create duplicate transcript entries.
- 5. Recovery MUST retain the exact ordered blocks until one acknowledgement clears the raw data; it MUST NOT persist, auto-retry, replay, or emit those blocks.
</requirements>

## Subtasks

- [x] 1.1 Establish the protocol-free prompt-block, request, phase, and state vocabulary described by the TechSpec Core Interfaces section.
- [x] 1.2 Add pure lifecycle transitions for enqueue, safe-boundary wait, cancellation, settlement, send, delivery, recovery, and acknowledgement.
- [x] 1.3 Extend session events and the pure reducer so steering state is initialized and changed only through reducer events.
- [x] 1.4 Preserve transcript ordering and all unrelated derived session fields during steering-only transitions.
- [x] 1.5 Add exhaustive lifecycle, stale-settlement, coalescing, and recovery-clear coverage.

## Implementation Details

Implement the model and reducer wiring described in the TechSpec “Core Interfaces,” “Data Models,” and “Testing Approach” sections. This task deliberately defines state truth only; controller effects, adapter calls, selector projection, and persistence/telemetry tests remain outside its source scope.

### Relevant Files

- `src/core/types.ts` — owns the protocol-free session, event, and prompt-block contracts.
- `src/core/steering.ts` — new pure lifecycle transition module with no runtime dependencies.
- `src/core/steering.test.ts` — new exhaustive transition and stale-event test suite.
- `src/core/sessionReducer.ts` — initializes steering state and applies its closed domain-event variants.
- `src/core/sessionReducer.test.ts` — verifies reducer integration, structural sharing, and transcript invariants.

### Dependent Files

- `src/store/appStore.ts` — forwards steering events through the existing reducer-only session write path.
- `src/persistence/runWriter.ts` — must retain its whitelist snapshot and exclude live steering state.
- `src/app/steeringCoordinator.ts` — will dispatch only the lifecycle events established here.

### Related ADRs

- [ADR-001: Adopt a Lossless, Provider-Neutral Steering Contract for V1](adrs/adr-001.md) — defines ordered, recoverable steering outcomes.
- [ADR-003: Model Steering as a Protocol-Free State Machine with a Controller Effect Runner](adrs/adr-003.md) — assigns lifecycle truth to the core reducer.
- [ADR-004: Fail Closed on Native Steering and Recover Unsent Text on Lifecycle Loss](adrs/adr-004.md) — requires one-time live recovery without replay.

## Deliverables

- Protocol-free steering state, events, and pure lifecycle transitions.
- Reducer-owned initialization and event handling that preserves structural sharing and transcript semantics.
- Unit tests with 80%+ coverage of new core lifecycle behavior.
- Integration tests for the steering-module-to-session-reducer event sequence.

## Tests

- Unit tests:
  - [x] Each legal phase transition accepts the current request id and generation and produces the documented phase.
  - [x] A stale request id, stale generation, invalid phase transition, or duplicate terminal settlement returns the identical state reference.
  - [x] Multiple accepted directions retain chronological block order and coalesce into exactly one delivered user turn.
  - [x] Recovery retains exact ordered blocks until acknowledgement and acknowledgement clears the raw queue and recovery payload.
  - [x] Steering-only events preserve transcript-derived referenced-file and pending-diff references.
- Integration tests:
  - [x] A folded `DomainSessionEvent` sequence initializes, queues, delivers, and acknowledges recovery through `sessionReducer` without ACP imports or a duplicate user turn.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Session state has one deterministic, protocol-free steering lifecycle authority.
- Every stale or duplicate settlement is an observable reducer no-op rather than a state overwrite.
