---
status: completed
title: "Suspend sessions, session-picker, and model-selector handlers during clarification preemption"
type: frontend
complexity: high
---

# Task 9: Suspend sessions, session-picker, and model-selector handlers during clarification preemption

## Overview
Suspend keyboard and filter input behavior for fleet, restored-session, and model-selection overlays during clarification. Each overlay stays visible and retains its state, then resumes only after the clarification reaches a terminal outcome.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST return before each suspended handler consumes or interprets a key.
2. MUST block SessionPicker filter focus while clarification is active.
3. MUST not switch focus, restore/delete a session, apply model configuration, or close a suspended overlay.
4. MUST resume the existing selection, filter, and confirmation state after clarification settles.
</requirements>

## Subtasks
- [x] 9.1 Gate fleet overview keyboard input.
- [x] 9.2 Gate restored-session picker keyboard and filter input.
- [x] 9.3 Gate model selector keyboard input.
- [x] 9.4 Add resumption regressions for all three overlays.

## Implementation Details
Follow the TechSpec sections System Architecture, Implementation Design, Testing Approach, and Development Sequencing. Keep ACP at the adapter boundary, preserve the reducer as the only SessionState writer, and use existing fail-soft actions and immutable store patterns.

### Relevant Files
- src/ui/SessionsOverlay.tsx — clarification handler gate.
- src/ui/SessionsOverlay.test.tsx — fleet overlay regression.
- src/ui/SessionPicker.tsx — keyboard and filter-focus gate.
- src/ui/SessionPicker.test.tsx — restore/delete/filter regression.
- src/ui/ModelSelect.tsx — clarification handler gate.
- src/ui/ModelSelect.test.tsx — config/close regression.

### Dependent Files
- src/store/selectors.ts — clarification-active selector.
- src/ui/ClarificationPrompt.tsx — active top-layer modal from Task 07.

### Related ADRs
- [ADR-002: Present supported clarification requests as immediate session-attributed dialogs](adrs/adr-002.md)
- [ADR-004: Coordinate agent interactions in the controller with clarification priority](adrs/adr-004.md)

## Deliverables
- Completed suspend sessions, session-picker, and model-selector handlers during clarification preemption behavior.
- Updated or new focused tests covering the stated requirements.
- Unit tests with 80%+ coverage (REQUIRED).
- Integration tests for the relevant clarification lifecycle (REQUIRED).

## Tests
- Unit tests:
  - [x] Sessions overlay ignores Enter, n, arrows, and Escape while clarification is active.
  - [x] Session picker ignores Enter, delete chord, and printable filter input while clarification is active.
  - [x] Model selector ignores navigation, confirmation, and Escape while clarification is active.
  - [x] Each overlay resumes its preexisting action after clarification settles.
- Integration tests:
  - [x] Exercise this task through its declared boundary with its declared dependencies present.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Requirements are satisfied without ACP types escaping src/agent.
- Existing permission, prompt, and modal behavior remains unchanged outside active clarification.
