---
status: completed
title: "Extend content-free clarification telemetry and notification coverage"
type: backend
complexity: high
---

# Task 11: Extend content-free clarification telemetry and notification coverage

## Overview
Record clarification lifecycle outcomes through Kitten’s opt-in, local, content-free telemetry and prove existing notification behavior handles the new needy status. Timing begins when the coordinator projects an active dialog and ends once on terminal settlement.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST use closed enums, booleans, anonymous session references, coarse buckets, and timestamps only.
2. MUST record presented, settled, preempted or resumed, session-loss cancellation, and capability classification lifecycle facts.
3. MUST represent mixed forms with non-exclusive shape flags and a field-count bucket.
4. MUST never record prompt, option, selected value, text answer, cwd, path, command, or adapter recipe content.
</requirements>

## Subtasks
- [x] 11.1 Define closed clarification telemetry events.
- [x] 11.2 Emit lifecycle facts from the coordinator.
- [x] 11.3 Add privacy and timing regression coverage.
- [x] 11.4 Verify notification behavior stays generic and content-free.

## Implementation Details
Follow the TechSpec sections System Architecture, Implementation Design, Testing Approach, and Development Sequencing. Keep ACP at the adapter boundary, preserve the reducer as the only SessionState writer, and use existing fail-soft actions and immutable store patterns.

### Relevant Files
- src/app/controller.ts — coordinator telemetry hooks.
- src/app/controller.test.ts — lifecycle emission coverage.
- src/telemetry/recorder.ts — closed event methods and timing.
- src/telemetry/recorder.test.ts — privacy and duration coverage.
- test/telemetry.integration.test.ts — local JSONL lifecycle integration.
- src/notify/notifier.test.ts — clarification notification regression.

### Dependent Files
- src/app/controller.ts — coordinator from Task 05.
- src/store/selectors.ts — clarification attention from Task 03.
- src/app/actions.ts — active projection from Task 06.

### Related ADRs
- [ADR-001: Scope the clarification picker around explicit structured requests](adrs/adr-001.md)
- [ADR-004: Coordinate agent interactions in the controller with clarification priority](adrs/adr-004.md)
- [ADR-005: Terminally cancel pending clarification on session loss](adrs/adr-005.md)

## Deliverables
- Completed extend content-free clarification telemetry and notification coverage behavior.
- Updated or new focused tests covering the stated requirements.
- Unit tests with 80%+ coverage (REQUIRED).
- Integration tests for the relevant clarification lifecycle (REQUIRED).

## Tests
- Unit tests:
  - [x] Enabled telemetry records one ordered lifecycle with coarse duration and mixed-form flags.
  - [x] Disabled telemetry remains empty.
  - [x] Serialized telemetry excludes all request and answer content.
  - [x] Unfocused clarification transition alerts once while focused or already-needy transitions do not alert.
- Integration tests:
  - [x] Exercise this task through its declared boundary with its declared dependencies present.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Requirements are satisfied without ACP types escaping src/agent.
- Existing permission, prompt, and modal behavior remains unchanged outside active clarification.
