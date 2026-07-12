---
status: pending
title: "Add end-to-end clarification lifecycle regression coverage"
type: test
complexity: high
---

# Task 12: Add end-to-end clarification lifecycle regression coverage

## Overview
Add the in-memory ACP-to-UI-to-ACP regression suite that proves the assembled feature behaves as one lifecycle. It uses the real SDK wire fixture, real controller, and mounted cockpit without enabling any real provider recipe.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST use the in-memory ACP transport and mock agent rather than external adapters.
2. MUST prove answered and cancelled outcomes reach the original ACP callback exactly once.
3. MUST prove clarification preempts and resumes an existing permission and local overlay.
4. MUST prove session loss cancels without replay and background clarification reaches the shared attention surface.
</requirements>

## Subtasks
- [ ] 12.1 Extend the in-memory mock with scripted elicitation.
- [ ] 12.2 Mount real adapter, controller, and cockpit lifecycle.
- [ ] 12.3 Cover answer, cancellation, preemption, and loss flows.
- [ ] 12.4 Preserve no-clarification regression coverage.

## Implementation Details
Follow the TechSpec sections System Architecture, Implementation Design, Testing Approach, and Development Sequencing. Keep ACP at the adapter boundary, preserve the reducer as the only SessionState writer, and use existing fail-soft actions and immutable store patterns.

### Relevant Files
- test/clarificationLifecycle.integration.test.tsx — new assembled lifecycle suite.
- test/mockAgent.ts — scripted elicitation helper and captured outcomes.

### Dependent Files
- src/agent/agentConnection.ts — elicitation mapping from Task 04.
- src/app/controller.ts — coordinator and cleanup from Task 05.
- src/ui/ClarificationPrompt.tsx — dialog from Task 07.
- src/telemetry/recorder.ts — telemetry behavior from Task 11.

### Related ADRs
- [ADR-002: Present supported clarification requests as immediate session-attributed dialogs](adrs/adr-002.md)
- [ADR-003: Fail closed on a verified ACP elicitation allowlist](adrs/adr-003.md)
- [ADR-004: Coordinate agent interactions in the controller with clarification priority](adrs/adr-004.md)
- [ADR-005: Terminally cancel pending clarification on session loss](adrs/adr-005.md)

## Deliverables
- Completed add end-to-end clarification lifecycle regression coverage behavior.
- Updated or new focused tests covering the stated requirements.
- Unit tests with 80%+ coverage (REQUIRED).
- Integration tests for the relevant clarification lifecycle (REQUIRED).

## Tests
- Unit tests:
  - [ ] Mock form request opens a session-attributed dialog, submits selected/text values, clears the overlay, and completes the original prompt.
  - [ ] Escape sends one cancellation and duplicate keys cannot settle another request.
  - [ ] Clarification preempts permission and settings, then each resumes unchanged.
  - [ ] Dispose or restoration cancels once, clears UI, and rejects stale replay; status is observable through the real attention surface.
- Integration tests:
  - [ ] Exercise this task through its declared boundary with its declared dependencies present.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Requirements are satisfied without ACP types escaping src/agent.
- Existing permission, prompt, and modal behavior remains unchanged outside active clarification.
