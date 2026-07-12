---
status: pending
title: "Add core clarification model and status compatibility"
type: backend
complexity: high
---

# Task 2: Add core clarification model and status compatibility

## Overview
Add the ACP-free payload, field, option, and outcome contract needed by all downstream layers. Introduce awaiting clarification as a first-class session status while preserving the reducer as the only writer of SessionState.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST keep ACP types, request IDs, connection generations, and resolver promises out of the core.
2. MUST add awaiting_clarification as a needy status without changing existing approval semantics.
3. MUST update exhaustive status compatibility records so typecheck remains green.
4. MUST preserve reducer structural sharing and existing transcript and plan data during status transitions.
</requirements>

## Subtasks
- [ ] 2.1 Define normalized clarification payload and outcome types.
- [ ] 2.2 Add awaiting clarification to the pure status model.
- [ ] 2.3 Preserve immutable reducer behavior for clarification transitions.
- [ ] 2.4 Update required exhaustive compatibility maps.

## Implementation Details
Follow the TechSpec sections System Architecture, Implementation Design, Testing Approach, and Development Sequencing. Keep ACP at the adapter boundary, preserve the reducer as the only SessionState writer, and use existing fail-soft actions and immutable store patterns.

### Relevant Files
- src/core/types.ts — clarification contracts and status predicate.
- src/core/types.test.ts — contract and needs-attention coverage.
- src/core/sessionReducer.ts — pure status transition compatibility.
- src/core/sessionReducer.test.ts — lifecycle transition regression coverage.
- src/store/selectors.ts — exhaustive attention rank compatibility.
- src/ui/StatusStrip.tsx — clarification status vocabulary.
- src/ui/theme.ts — clarification tone in every palette.

### Dependent Files
- src/app/controller.ts — owns request IDs, generations, and settlement in Task 05.
- src/ui/SessionsOverlay.tsx — consumes shared status presentation in Task 03.

### Related ADRs
- [ADR-001: Scope the clarification picker around explicit structured requests](adrs/adr-001.md)
- [ADR-004: Coordinate agent interactions in the controller with clarification priority](adrs/adr-004.md)

## Deliverables
- Completed add core clarification model and status compatibility behavior.
- Updated or new focused tests covering the stated requirements.
- Unit tests with 80%+ coverage (REQUIRED).
- Integration tests for the relevant clarification lifecycle (REQUIRED).

## Tests
- Unit tests:
  - [ ] Single, multi, and text field contracts accept only normalized values.
  - [ ] needsAttention returns true for awaiting_clarification and retains prior outcomes for other statuses.
  - [ ] Reducer transitions preserve unrelated session references and content.
  - [ ] Existing exhaustive status maps compile after the new status is introduced.
- Integration tests:
  - [ ] Exercise this task through its declared boundary with its declared dependencies present.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Requirements are satisfied without ACP types escaping src/agent.
- Existing permission, prompt, and modal behavior remains unchanged outside active clarification.
