---
status: completed
title: "Integrate History into Session State and Selectors"
type: backend
complexity: high
---

# Task 2: Integrate History into Session State and Selectors

## Overview

Make prompt history an immutable, per-session state slice owned exclusively by Kitten’s core reducer. This gives live sessions a narrow selector for recall state and guarantees that replacing a session for a new run starts with no retained prompts.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add prompt-history state to every `SessionState` with an empty initial value.
2. MUST extend the domain event union so record, previous, and next transitions route through `sessionReducer` only.
3. MUST preserve immutable structural sharing: an event for one session cannot replace unrelated session slices.
4. MUST expose a narrow per-session selector whose reference remains stable across unrelated updates.
5. MUST reset history through the existing session recreation path, with no bespoke cleanup outside the core lifecycle.
</requirements>

## Subtasks

- [x] 2.1 Add the history contract from task 1 to session state defaults and the domain event vocabulary.
- [x] 2.2 Route prompt-history events through the existing session reducer without weakening its exhaustive handling.
- [x] 2.3 Verify store event application preserves unaffected session identity and selector stability.
- [x] 2.4 Add a narrow selector for the history state consumed by the composer.
- [x] 2.5 Verify session replacement produces a fresh empty history without retaining prior prompts.

## Implementation Details

Follow the TechSpec’s **Data Models**, **System Architecture**, and **Impact Analysis** sections. The core reducer remains the sole writer; do not introduce direct `AppStore` mutations or a UI-owned fallback map.

### Relevant Files

- `src/core/types.ts` — declares `SessionState` and `DomainSessionEvent`.
- `src/core/sessionReducer.ts` — single immutable writer for every session slice.
- `src/core/sessionReducer.test.ts` — reducer target-slice and structural-sharing test pattern.
- `src/store/appStore.ts` — routes domain events and recreates sessions via `createSessionState`.
- `src/store/appStore.test.ts` — verifies store routing and reset behavior.
- `src/store/selectors.ts` — holds narrow, curried per-session selectors.
- `src/store/selectors.test.ts` — verifies selector reference stability across unrelated updates.

### Dependent Files

- `src/app/actions.ts` — will dispatch the new domain events through the store.
- `src/ui/PromptEditor.tsx` — will subscribe to the narrow history selector.
- `test/fakeController.ts` — will drive the state through the public actions contract.

### Related ADRs

- [ADR-003: Store Bounded Prompt History in Each Session Slice](adrs/adr-003.md) — requires core ownership and lifecycle reset.
- [ADR-001: Scope Prompt Recall to the Active Agent Session](adrs/adr-001.md) — requires per-session isolation and current-run cleanup.

## Deliverables

- Session state, event, reducer, store-routing, and selector updates for prompt history.
- Reducer, store, and selector regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for session history lifecycle and isolation **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] A new session starts with no entries and no active recall cursor.
  - [x] A prompt-history event changes only the addressed session while the other session keeps reference identity.
  - [x] Unrelated status, transcript, shell, and preference changes keep the history selector reference stable.
  - [x] Each record, previous, and next event delegates to the task-01 transition behavior.
- Integration tests:
  - [x] Applying history events through `AppStore.applyEvent` updates the focused session selector without changing another session.
  - [x] `startSession` or a new-run replacement recreates the session with an empty history slice.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Prompt history is state-owned by the addressed session and only the core reducer writes it.
- Recreated sessions never retain prompts from their prior run.
