---
status: completed
title: Store Explorer State, Transitions, and Narrow Selectors
type: refactor
complexity: medium
---

# Task 1: Store Explorer State, Transitions, and Narrow Selectors

## Overview

Make the AppStore the single owner of current-run explorer state for every open session. This gives the UI stable, session-addressed state without putting filesystem or process concerns in React components.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- Explorer state MUST be hidden by default and keyed by `SessionId`, with no cross-session mutation or shared mutable tree state.
- State transitions MUST cover visibility, focused region, selected row, expanded directories, scroll position, fixed notice, and refresh generation.
- Async-result commits MUST be rejected when the session, workspace root, or request generation is no longer current.
- Session removal MUST clear its explorer state, and narrow selectors MUST preserve identity for unrelated session updates.
</requirements>

## Subtasks

- [x] 1.1 Define the minimal session-addressed explorer state and initial state.
- [x] 1.2 Add focused-pane and explorer transition actions to the AppStore.
- [x] 1.3 Add request-generation and removal-cleanup behavior.
- [x] 1.4 Expose narrow selectors for the visible and focused session explorer state.
- [x] 1.5 Cover isolation, stale-result, and cleanup behavior in store and selector tests.

## Implementation Details

Follow the TechSpec “State Model and Store Actions” and “State Invariants” sections. Mirror existing per-session store ownership such as transcript windows; keep render-only measurement and controller I/O outside the store.

### Relevant Files

- `src/store/appStore.ts` — owns session-addressed run state and all mutations.
- `src/store/selectors.ts` — provides focused-session and narrow subscription selectors.
- `src/store/appStore.test.ts` — existing state-transition test conventions.
- `src/store/selectors.test.ts` — existing selector identity and focused-session coverage.

### Dependent Files

- `src/app/actions.ts` — will commit controller results through the new store actions.
- `src/ui/CockpitApp.tsx` — will select explorer state to compose presentation.

### Related ADRs

- [ADR-001: Keep a safety-complete session explorer as the V1 boundary](adrs/adr-001.md) — requires safe, narrow scope rather than global workspace behavior.
- [ADR-002: Validate repeat multi-session use before expanding the explorer](adrs/adr-002.md) — requires session isolation for credible beta measurement.

## Deliverables

- Session-scoped explorer state, transitions, generation fencing, and selectors.
- Removal cleanup and selector stability guarantees.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for session isolation **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Two sessions retain distinct selection, expansion, scroll, and notice state.
  - [x] A stale generation or mismatched workspace root cannot overwrite current explorer state.
  - [x] Removing a session removes only that session’s explorer state.
  - [x] Unrelated session updates preserve the selected explorer slice identity.
- Integration tests:
  - [x] Focus switching restores the selected session’s current-run explorer state without touching another session.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Explorer state is current-run, session-addressed, and store-owned.
- Stale async work and removed sessions cannot produce visible state changes.
