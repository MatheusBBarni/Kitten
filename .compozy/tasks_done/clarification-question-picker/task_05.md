---
status: completed
title: "Replace the permission queue with a controller interaction coordinator"
type: refactor
complexity: high
---

# Task 5: Replace the permission queue with a controller interaction coordinator

## Overview
Replace the controller-private permission FIFO with a discriminated coordinator for permission and clarification lifecycles. It owns request identity, generation safety, clarification preemption, suspended interaction resumption, and terminal cleanup.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST keep resolver promises and active/suspended lifecycle state controller-private.
2. MUST preserve permission FIFO behavior while allowing clarification to preempt without settling the prior interaction.
3. MUST reject stale, duplicate, wrong-request, and wrong-generation settlement attempts.
4. MUST terminally cancel matching active, queued, and suspended entries on replacement, restore, disconnect, and disposal.
</requirements>

## Subtasks
- [x] 5.1 Define discriminated pending interaction lifecycle.
- [x] 5.2 Capture controller connection generations.
- [x] 5.3 Implement preemption and deterministic resumption.
- [x] 5.4 Implement replacement and disposal terminal cleanup.

## Implementation Details
Follow the TechSpec sections System Architecture, Implementation Design, Testing Approach, and Development Sequencing. Keep ACP at the adapter boundary, preserve the reducer as the only SessionState writer, and use existing fail-soft actions and immutable store patterns.

### Relevant Files
- src/app/controller.ts — coordinator and callback lifecycle.
- src/app/controller.test.ts — coordinator regression suite.

### Dependent Files
- src/core/types.ts — clarification payload, outcome, and status.
- src/agent/agentConnection.ts — protocol-free callback from Task 04.
- src/app/actions.ts — receives public response wiring in Task 06.

### Related ADRs
- [ADR-004: Coordinate agent interactions in the controller with clarification priority](adrs/adr-004.md)
- [ADR-005: Terminally cancel pending clarification on session loss](adrs/adr-005.md)

## Deliverables
- Completed replace the permission queue with a controller interaction coordinator behavior.
- Updated or new focused tests covering the stated requirements.
- Unit tests with 80%+ coverage (REQUIRED).
- Integration tests for the relevant clarification lifecycle (REQUIRED).

## Tests
- Unit tests:
  - [x] Permission requests remain FIFO and advance only after the displayed request settles.
  - [x] Clarification preempts a permission and the unchanged permission resumes after settlement.
  - [x] Wrong ID, old generation, and duplicate answers are no-ops.
  - [x] Session replacement and disposal cancel matching entries exactly once while another session remains usable.
- Integration tests:
  - [x] Exercise this task through its declared boundary with its declared dependencies present.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Requirements are satisfied without ACP types escaping src/agent.
- Existing permission, prompt, and modal behavior remains unchanged outside active clarification.
