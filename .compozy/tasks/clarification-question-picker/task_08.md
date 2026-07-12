---
status: pending
title: "Suspend approval and handoff modal handlers during clarification preemption"
type: frontend
complexity: high
---

# Task 8: Suspend approval and handoff modal handlers during clarification preemption

## Overview
Make approval and handoff overlays retain their state while clarification is active but relinquish keyboard ownership. This enforces ADR-004 preemption without closing, sending, selecting, or resetting the suspended interaction.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST gate each handler before preventDefault, local mutation, close, or controller action.
2. MUST leave suspended approval and handoff state unchanged until clarification settles.
3. MUST preserve existing approval priority behavior.
4. MUST resume normal behavior without reconstructing the suspended overlay.
</requirements>

## Subtasks
- [ ] 8.1 Gate approval keyboard handling.
- [ ] 8.2 Gate handoff preview keyboard handling.
- [ ] 8.3 Gate handoff target picker keyboard handling.
- [ ] 8.4 Add state-preserving preemption regressions.

## Implementation Details
Follow the TechSpec sections System Architecture, Implementation Design, Testing Approach, and Development Sequencing. Keep ACP at the adapter boundary, preserve the reducer as the only SessionState writer, and use existing fail-soft actions and immutable store patterns.

### Relevant Files
- src/ui/ApprovalPrompt.tsx — clarification priority gate.
- src/ui/ApprovalPrompt.test.tsx — permission suspension coverage.
- src/ui/HandoffPreview.tsx — clarification priority gate.
- src/ui/HandoffPreview.test.tsx — preview suspension coverage.
- src/ui/HandoffTargetPicker.tsx — clarification priority gate.
- src/ui/HandoffTargetPicker.test.tsx — target-picker suspension coverage.

### Dependent Files
- src/store/selectors.ts — clarification-active selector.
- src/ui/ClarificationPrompt.tsx — active top-layer modal from Task 07.

### Related ADRs
- [ADR-002: Present supported clarification requests as immediate session-attributed dialogs](adrs/adr-002.md)
- [ADR-004: Coordinate agent interactions in the controller with clarification priority](adrs/adr-004.md)

## Deliverables
- Completed suspend approval and handoff modal handlers during clarification preemption behavior.
- Updated or new focused tests covering the stated requirements.
- Unit tests with 80%+ coverage (REQUIRED).
- Integration tests for the relevant clarification lifecycle (REQUIRED).

## Tests
- Unit tests:
  - [ ] Enter, Escape, and digits do not respond to approval while clarification is active.
  - [ ] Handoff preview cannot send, discard, or edit while clarification owns input.
  - [ ] Handoff target picker cannot select or close while clarification is active.
  - [ ] After settlement, each suspended overlay performs its original action unchanged.
- Integration tests:
  - [ ] Exercise this task through its declared boundary with its declared dependencies present.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Requirements are satisfied without ACP types escaping src/agent.
- Existing permission, prompt, and modal behavior remains unchanged outside active clarification.
