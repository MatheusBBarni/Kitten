---
status: pending
title: "Build the clarification dialog and keyboard workflow"
type: frontend
complexity: high
---

# Task 7: Build the clarification dialog and keyboard workflow

## Overview
Build the dedicated terminal modal that consumes the active clarification projection from Task 06. It supports single choice, compatible multi-choice, text, explicit cancellation, and one terminal result without using permission terminology or ordinary prompt submission.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST mount clarification above normal cockpit overlays and consume every key while active.
2. MUST support arrows and digits, multi-select toggle, text focus, Enter submission, and Escape terminal cancellation.
3. MUST show session title, cwd, prompt, labels, descriptions, explicit cancellation, and a non-color selection marker.
4. MUST use only ControllerActions respondClarification and guard against duplicate settlement.
</requirements>

## Subtasks
- [ ] 7.1 Render a session-attributed clarification dialog.
- [ ] 7.2 Add dedicated keyboard commands and hints.
- [ ] 7.3 Implement single, multi, text, and cancellation outcomes.
- [ ] 7.4 Prove focus isolation and one-answer behavior.

## Implementation Details
Follow the TechSpec sections System Architecture, Implementation Design, Testing Approach, and Development Sequencing. Keep ACP at the adapter boundary, preserve the reducer as the only SessionState writer, and use existing fail-soft actions and immutable store patterns.

### Relevant Files
- src/ui/ClarificationPrompt.tsx — new dialog.
- src/ui/ClarificationPrompt.test.tsx — dialog interaction coverage.
- src/ui/CockpitApp.tsx — topmost mount.
- src/ui/keymap.ts — clarification commands and hints.
- src/ui/keymap.test.ts — matcher and hint coverage.

### Dependent Files
- src/store/selectors.ts — active clarification selector from Task 06.
- test/fakeController.ts — recorded clarification response action.
- src/ui/ApprovalPrompt.tsx — established one-answer modal precedent.

### Related ADRs
- [ADR-001: Scope the clarification picker around explicit structured requests](adrs/adr-001.md)
- [ADR-002: Present supported clarification requests as immediate session-attributed dialogs](adrs/adr-002.md)
- [ADR-004: Coordinate agent interactions in the controller with clarification priority](adrs/adr-004.md)

## Deliverables
- Completed build the clarification dialog and keyboard workflow behavior.
- Updated or new focused tests covering the stated requirements.
- Unit tests with 80%+ coverage (REQUIRED).
- Integration tests for the relevant clarification lifecycle (REQUIRED).

## Tests
- Unit tests:
  - [ ] Single-select arrows, digit, and Enter return exactly one stable option.
  - [ ] Multi-select Space toggles without settling and Enter returns all selected values.
  - [ ] Text input receives printable keys and submits only its text value.
  - [ ] Escape resolves one cancellation; duplicate keys, shell chords, help, and composer input do not leak through.
- Integration tests:
  - [ ] Exercise this task through its declared boundary with its declared dependencies present.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Requirements are satisfied without ACP types escaping src/agent.
- Existing permission, prompt, and modal behavior remains unchanged outside active clarification.
