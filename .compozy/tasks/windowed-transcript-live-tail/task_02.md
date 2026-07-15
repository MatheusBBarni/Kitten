---
status: pending
title: Add Per-Session Presentation State and Selectors
type: refactor
complexity: medium
---

# Task 02: Add Per-Session Presentation State and Selectors

## Overview

Add transient per-session history depth, detached-reading state, and scroll offset to AppStore, then expose the projection through narrow selectors. This makes the chosen view survive focus changes without entering SessionState or persisted run records.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST store a non-persisted TranscriptWindowState per SessionId with non-negative revealed history, detached state, and nullable scroll offset.
2. MUST seed, retain, reset, and remove state correctly across add, start, replace, remove, and delegated-child lifecycles.
3. MUST provide session-scoped reveal, anchor, detached-state, and return-to-live actions with safe no-op behavior.
4. MUST expose narrow memoized selectors that combine only the addressed session, relevant approval tool protection, and task 01 projection contract.
5. MUST not alter SessionState, sessionReducer, ACP translation, or run-record serialization.
</requirements>

## Subtasks

- [ ] Define the transient window state and default entry lifecycle in AppStore.
- [ ] Add session-scoped actions for history reveal, detached reading, anchor capture, and return to live.
- [ ] Reconcile entries at session creation, replacement, and removal boundaries.
- [ ] Add per-session window and projection selectors with focused-session isolation.
- [ ] Cover no-op, structural-sharing, overlay, and lifecycle behavior.

## Implementation Details

Modify src/store/appStore.ts, src/store/appStore.test.ts, src/store/selectors.ts, and src/store/selectors.test.ts. Use the TechSpec System Architecture and Testing Approach sections. Treat task 01 projection types as an input-only core contract; task 08 owns renderer-specific behavior.

### Relevant Files

- src/store/appStore.ts — transient AppState entries, actions, and lifecycle cleanup.
- src/store/appStore.test.ts — state isolation and lifecycle coverage.
- src/store/selectors.ts — narrow window/projection selectors.
- src/store/selectors.test.ts — memoization and subscription coverage.
- src/core/transcriptProjection.ts — task 01 contract consumed by selectors.
- src/core/types.ts — SessionId, Turn, and tool status source types.
- src/ui/ConversationView.tsx — dependent consumer in task 08.

### Dependent Files

- src/ui/ConversationView.tsx — consumes selectors and actions in task 08.
- src/ui/CockpitApp.tsx — invokes actions through task 09 commands.
- src/persistence/runWriter.ts — must remain unchanged; this state is transient.

### Related ADRs

- [ADR-001: Ship a flagged bounded live transcript projection](adrs/adr-001.md) — Requires independent live-session continuity.
- [ADR-002: Launch bounded live history as a truth-first experiment](adrs/adr-002.md) — Requires preserved reading position.
- [ADR-003: Separate transcript projection from semantic session state](adrs/adr-003.md) — Defines store ownership.

## Deliverables

- Per-session transient window state and actions.
- Narrow window/projection selectors with structural-sharing guarantees.
- Store and selector tests for every lifecycle boundary.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Store-to-projection integration tests **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] New sessions start with zero revealed history, attached state, and null offset.
  - [ ] Revealing/anchoring one session preserves a sibling session entry and focus switching retains both.
  - [ ] Unknown sessions and equivalent actions are AppState no-ops with no subscription notification.
  - [ ] Stream, unrelated session, and overlay changes retain unaffected window-entry references.
  - [ ] Start, add, replace, remove, and removeDelegationChild reset or discard only the correct entries.
  - [ ] Matching approval tools protect projection content while clarification creates no invented transcript ownership.
- Integration tests:
  - [ ] A focused projection subscription remains silent for an unfocused session stream.
  - [ ] Disabled projection input returns the complete turn presentation.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Each live session retains only its own transient history state.
- No window or scroll value reaches SessionState or persisted run records.
