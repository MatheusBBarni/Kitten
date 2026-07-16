---
status: completed
title: Steering Store Projection and Selectors
type: refactor
complexity: medium
---

# Task 02: Steering Store Projection and Selectors

## Overview

Expose the reducer-owned steering lifecycle to focused consumers without creating a second state authority or broad subscriptions. The store and selectors must provide compact composer-facing status and one-time recovery access while retaining existing identity and isolation guarantees.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. All steering lifecycle changes, including recovery acknowledgement, MUST reach `SessionState` only through `AppStore.applyEvent()` and `sessionReducer`.
- 2. Per-session selectors MUST expose only phase, queue count, and recovery availability to ordinary consumers; they MUST safely handle null or unknown sessions.
- 3. The focused recovery path MAY access raw recovery blocks, but generic projections MUST NOT expose raw blocks, request ids, or raw errors.
- 4. Curried session selectors MUST keep stable fallback references and MUST remain referentially stable for unrelated session and token updates.
- 5. This task MUST NOT introduce transport decisions, timers, ACP imports, persistence writes, telemetry emission, or transcript derivation in store/selectors.
</requirements>

## Subtasks

- [x] 2.1 Add the minimal store action surface required to acknowledge an already reducer-owned recovery payload.
- [x] 2.2 Add narrow per-session steering status and recovery selectors with stable empty fallbacks.
- [x] 2.3 Keep generic projections content-free while reserving raw blocks for the focused acknowledgement path.
- [x] 2.4 Verify reducer-routed updates preserve other sessions, workspace state, and unrelated selector identities.
- [x] 2.5 Cover phase, count, recovery availability, missing-session, and subscription-stability behavior.

## Implementation Details

Follow the TechSpec “System Architecture,” “Data Models,” and Build Order step 2. Reuse the app store’s existing `applyEvent` and curried-selector patterns instead of adding parallel mutable steering state.

### Relevant Files

- `src/store/appStore.ts` — owns event routing, subscriptions, and any public recovery-acknowledgement seam.
- `src/store/appStore.test.ts` — tests target-session routing, immutability, and selector subscription silence.
- `src/store/selectors.ts` — exports narrow curried steering phase/count/recovery selectors.
- `src/store/selectors.test.ts` — tests projected values and `Object.is` stability.

### Dependent Files

- `src/core/types.ts` — supplies the closed session and steering event contract.
- `src/core/sessionReducer.ts` — remains the sole session-state writer.
- `src/core/steering.ts` — owns lifecycle and recovery semantics projected here.
- `src/ui/PromptEditor.tsx` — consumes only the compact status and focused recovery selectors.

### Related ADRs

- [ADR-002: Make V1 Steering Lossless and Composer-First](adrs/adr-002.md) — requires concise composer status and exact recovery.
- [ADR-003: Model Steering as a Protocol-Free State Machine with a Controller Effect Runner](adrs/adr-003.md) — preserves reducer/store ownership boundaries.
- [ADR-004: Fail Closed on Native Steering and Recover Unsent Text on Lifecycle Loss](adrs/adr-004.md) — constrains raw recovery visibility and lifetime.

## Deliverables

- Reducer-routed recovery acknowledgement plumbing with no direct session mutation.
- Stable per-session selectors for compact steering status and focused recovery access.
- Unit tests with 80%+ coverage of selector projection and store identity behavior.
- Integration tests for steering events flowing through the real app store and reducer.

## Tests

- Unit tests:
  - [x] Phase, queue count, and recovery-availability selectors return the expected values for idle, queued, sending, and failed states.
  - [x] Null, missing, and no-recovery sessions return stable documented fallback values.
  - [x] A generic steering projection never includes raw blocks, request ids, or raw failure details.
  - [x] An unrelated token update and another session’s steering event do not change a selected session’s selector reference or notify its subscriber.
  - [x] Recovery access changes only when the addressed session receives its steering events or acknowledgement.
- Integration tests:
  - [x] The real app store applies enqueue and acknowledgement events through `sessionReducer`, preserving untouched session and workspace references.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The UI can render compact steering state without owning or mutating lifecycle truth.
- Unrelated store updates do not cause steering selector churn.
