---
status: pending
title: "Project clarification interactions through actions, store, and selectors"
type: backend
complexity: high
---

# Task 6: Project clarification interactions through actions, store, and selectors

## Overview
Connect the coordinator to a dedicated UI-facing clarification projection and response action. The store remains an immutable projection only; it must never own ACP types, resolver promises, or a second queue.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add a separate clarification overlay payload and narrow selector.
2. MUST add a dedicated fail-soft respondClarification action that settles only the matching coordinator request.
3. MUST include clarification in open-overlay gating and capability discoverability.
4. MUST preserve approval, handoff, settings, session, preferences, and session-state references on clarification open and close.
</requirements>

## Subtasks
- [ ] 6.1 Add the clarification overlay projection.
- [ ] 6.2 Bind adapter callbacks to the controller coordinator.
- [ ] 6.3 Expose the dedicated response action.
- [ ] 6.4 Add immutable store and selector coverage.

## Implementation Details
Follow the TechSpec sections System Architecture, Implementation Design, Testing Approach, and Development Sequencing. Keep ACP at the adapter boundary, preserve the reducer as the only SessionState writer, and use existing fail-soft actions and immutable store patterns.

### Relevant Files
- src/app/controller.ts — active clarification projection and callback binding.
- src/app/controller.test.ts — projection and stale-response coverage.
- src/app/actions.ts — dedicated response action.
- src/store/appStore.ts — clarification overlay slot and immutable methods.
- src/store/appStore.test.ts — slot and identity coverage.
- src/store/selectors.ts — narrow overlay and capability selectors.
- src/store/selectors.test.ts — modal and selector stability coverage.

### Dependent Files
- src/config/clarificationCapability.ts — supported or unsupported view.
- src/agent/agentConnection.ts — clarification callback.
- src/app/controller.ts — coordinator from Task 05.
- test/fakeController.ts — downstream UI fixture must gain the response action.

### Related ADRs
- [ADR-003: Fail closed on a verified ACP elicitation allowlist](adrs/adr-003.md)
- [ADR-004: Coordinate agent interactions in the controller with clarification priority](adrs/adr-004.md)
- [ADR-005: Terminally cancel pending clarification on session loss](adrs/adr-005.md)

## Deliverables
- Completed project clarification interactions through actions, store, and selectors behavior.
- Updated or new focused tests covering the stated requirements.
- Unit tests with 80%+ coverage (REQUIRED).
- Integration tests for the relevant clarification lifecycle (REQUIRED).

## Tests
- Unit tests:
  - [ ] Active clarification appears with session attribution and closes only for the matching request.
  - [ ] Wrong or duplicate response does not settle or advance another request.
  - [ ] Clarification open alone makes selectHasOpenOverlay true.
  - [ ] Store changes preserve unrelated overlay and session identities.
- Integration tests:
  - [ ] Exercise this task through its declared boundary with its declared dependencies present.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Requirements are satisfied without ACP types escaping src/agent.
- Existing permission, prompt, and modal behavior remains unchanged outside active clarification.
