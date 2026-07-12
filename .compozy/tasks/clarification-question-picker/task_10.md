---
status: pending
title: "Suspend settings modal handler during clarification preemption"
type: frontend
complexity: medium
---

# Task 10: Suspend settings modal handler during clarification preemption

## Overview
Make SettingsView unmount its keyboard-owning dialog while a clarification is active without clearing the settings overlay or changing the selected theme. This prevents settings from competing with clarification Escape, arrows, and reset commands.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST preserve the settings overlay slot and selected theme during preemption.
2. MUST remove the SettingsView keyboard listener while clarification is active.
3. MUST preserve existing approval precedence and normal shell gating.
4. MUST restore the unchanged settings dialog after clarification settles.
</requirements>

## Subtasks
- [ ] 10.1 Extend the settings self-gate.
- [ ] 10.2 Preserve settings state during clarification.
- [ ] 10.3 Add keyboard ownership regressions.
- [ ] 10.4 Verify normal resumption after settlement.

## Implementation Details
Follow the TechSpec sections System Architecture, Implementation Design, Testing Approach, and Development Sequencing. Keep ACP at the adapter boundary, preserve the reducer as the only SessionState writer, and use existing fail-soft actions and immutable store patterns.

### Relevant Files
- src/ui/SettingsView.tsx — clarification self-gate.
- src/ui/SettingsView.test.tsx — state-preserving preemption coverage.
- src/ui/CockpitApp.test.tsx — optional shell-level preemption regression.

### Dependent Files
- src/store/selectors.ts — clarification-active selector.
- src/ui/ClarificationPrompt.tsx — active top-layer modal from Task 07.

### Related ADRs
- [ADR-002: Present supported clarification requests as immediate session-attributed dialogs](adrs/adr-002.md)
- [ADR-004: Coordinate agent interactions in the controller with clarification priority](adrs/adr-004.md)

## Deliverables
- Completed suspend settings modal handler during clarification preemption behavior.
- Updated or new focused tests covering the stated requirements.
- Unit tests with 80%+ coverage (REQUIRED).
- Integration tests for the relevant clarification lifecycle (REQUIRED).

## Tests
- Unit tests:
  - [ ] Settings is hidden while its store slot remains open during clarification.
  - [ ] Arrow, reset, and Escape cannot change theme or close settings during preemption.
  - [ ] After clarification settlement settings reappears and retains its prior state.
  - [ ] Shell-level Escape resolves clarification rather than settings.
- Integration tests:
  - [ ] Exercise this task through its declared boundary with its declared dependencies present.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Requirements are satisfied without ACP types escaping src/agent.
- Existing permission, prompt, and modal behavior remains unchanged outside active clarification.
