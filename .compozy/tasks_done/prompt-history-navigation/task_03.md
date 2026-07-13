---
status: completed
title: "Add Controller Recall Actions and Private Telemetry"
type: backend
complexity: high
---

# Task 3: Add Controller Recall Actions and Private Telemetry

## Overview

Expose the controller actions that let the composer record accepted submissions and retrieve a post-reduction recall result. Extend Kitten’s existing opt-in recorder with history outcomes while ensuring telemetry never receives prompt content or derived content fields.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add controller actions for recording a composer-originated prompt and navigating the addressed session’s history.
2. MUST record accepted nonblank composer input before the asynchronous agent call settles, so a later failure does not discard recall.
3. MUST return the post-reduction text, history position, and total needed by the UI, while returning no replacement for a no-op navigation.
4. MUST exclude handoff, initial-task, and other non-composer send paths from prompt-history recording.
5. MUST add only opt-in, content-free eligibility, recall, clear, and edited-resend telemetry events.
6. MUST not emit prompt text, hashes, exact length, capacity, history index, or entries in telemetry.
</requirements>

## Subtasks

- [x] 3.1 Extend the UI-facing controller action contract for record and navigation operations.
- [x] 3.2 Route the new actions through the existing store event path and preserve focused or explicit-session targeting.
- [x] 3.3 Update the fake controller so mounted UI tests drive the real history state contract.
- [x] 3.4 Extend the opt-in recorder’s typed event surface and disabled no-op surface.
- [x] 3.5 Emit only the approved content-free history outcomes and verify their record shapes.
- [x] 3.6 Add controller and recorder regressions for ordering, failures, isolation, and privacy.

## Implementation Details

Use the TechSpec’s **API Endpoints**, **Monitoring and Observability**, and **Technical Considerations** sections. The actual controller action seam is `src/app/actions.ts`; preserve the existing resilience rule that UI-triggered actions never reject into the React tree.

### Relevant Files

- `src/app/actions.ts` — defines `ControllerActions`, the action dependencies, and the prompt-send ordering.
- `src/app/controller.test.ts` — verifies the live controller/action behavior with agent test doubles.
- `src/telemetry/recorder.ts` — typed, local, opt-in content-free telemetry surface.
- `src/telemetry/recorder.test.ts` — memory-sink and exact-record privacy conventions.
- `test/fakeController.ts` — mounted UI controller double that must satisfy the expanded action contract.
- `test/fakeController.test.ts` — contract coverage for the test double.

### Dependent Files

- `src/ui/PromptEditor.tsx` — calls the record and navigation actions after this packet is complete.
- `src/ui/PromptEditor.test.tsx` — observes action calls and real store transitions through the fake controller.
- `src/app/controller.ts` — passes the concrete recorder and action surface into a live session controller.

### Related ADRs

- [ADR-003: Store Bounded Prompt History in Each Session Slice](adrs/adr-003.md) — constrains action routing to reducer-owned state.
- [ADR-005: Measure Prompt Recall Through Opt-In Content-Free Telemetry](adrs/adr-005.md) — defines event scope and privacy exclusions.

## Deliverables

- Controller action contract and concrete action implementation for record/navigation.
- Updated fake controller and controller action regressions.
- Opt-in content-free telemetry event support and recorder regressions.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for controller action and telemetry behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Recording an accepted nonblank composer prompt dispatches history state before an agent prompt promise resolves or rejects.
  - [x] Navigation for an explicit session id returns that session’s selected text without changing the focused session’s history.
  - [x] Empty history and next-from-idle navigation return no replacement text.
  - [x] Disabled telemetry writes no history records and enabled telemetry emits only approved fixed event names.
  - [x] Every new telemetry record lacks text, hashes, character lengths, capacity, indices, and entries.
- Integration tests:
  - [x] A controller action followed by a rejected agent call still leaves the submitted prompt recallable through the store.
  - [x] A fake controller used by a mounted view applies record/navigation events to the same session state that selectors read.
  - [x] Handoff and initial-task paths do not create composer-history telemetry or entries.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The composer can obtain a post-reduction recall result through `ControllerActions` without direct store writes.
- Telemetry remains opt-in, local, and provably content-free.
