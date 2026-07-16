---
status: pending
title: Content-Free Explorer Telemetry and Cross-Boundary Proof
type: backend
complexity: medium
---

# Task 9: Content-Free Explorer Telemetry and Cross-Boundary Proof

## Overview

Add opt-in local telemetry for explorer availability, refresh, and file-open outcomes, then prove that serialized records cannot contain repository or editor content. This delivers the approved beta evidence without weakening Kitten’s content-free telemetry boundary.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- Telemetry MUST add only closed explorer event families and outcome enums defined by the TechSpec.
- Records MUST NOT include paths, names, workspace identifiers, executable names, arguments, errors, tree structure, or stable user identity.
- Disabled telemetry MUST remain a no-op that creates no sink or serialized record.
- Action-facing telemetry calls MUST preserve custom-editor fallback ordering without logging the command or failure detail.
</requirements>

## Subtasks

- [ ] 9.1 Add the closed explorer telemetry event and outcome vocabulary.
- [ ] 9.2 Add recorder façade methods accepting only content-free values.
- [ ] 9.3 Emit action-boundary events for visibility, refresh, and settled launch outcomes.
- [ ] 9.4 Preserve disabled-recorder no-sink behavior.
- [ ] 9.5 Add serialized-record negative tests and cross-boundary event ordering coverage.

## Implementation Details

Follow the TechSpec “Monitoring and Observability,” “Telemetry Event Contracts,” and “Security and Privacy” sections. Extend the recorder’s closed union and facade pattern rather than emitting generic metadata or logging errors.

### Relevant Files

- `src/telemetry/recorder.ts` — closed event union, opt-in gate, serialization, and recorder façade.
- `src/telemetry/recorder.test.ts` — existing content-free and disabled-recorder test patterns.
- `src/app/actions.ts` — explorer boundary that knows only closed operation outcomes.
- `src/app/actions.test.ts` — action settlement and fallback behavior coverage.

### Dependent Files

- `test/telemetry.integration.test.ts` — new controller-action-to-recorder privacy-negative coverage.
- `src/index.ts` — existing recorder lifecycle ownership remains the opt-in source.

### Related ADRs

- [ADR-001: Keep a safety-complete session explorer as the V1 boundary](adrs/adr-001.md) — keeps telemetry proportional to the narrow V1.
- [ADR-002: Validate repeat multi-session use before expanding the explorer](adrs/adr-002.md) — supplies the beta measurement rationale.

## Deliverables

- Closed, opt-in explorer telemetry façade and event outcomes.
- Privacy-negative serialized-record and cross-boundary integration tests.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for telemetry sequencing and no-content behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Each explorer event serializes only its allowlisted closed outcome and coarse metadata.
  - [ ] Serialized records contain none of a fixture’s path, filename, workspace, executable, arguments, error text, tree data, or stable identity.
  - [ ] Disabled telemetry creates no sink writes or records.
  - [ ] Unsupported, source-failed, default-opened, custom-opened, fallback, and final-failure outcomes remain closed and distinguishable.
- Integration tests:
  - [ ] Controller action settlement reaches the recorder without passing source or launcher content.
  - [ ] Custom-editor failure records fallback and final outcome in the required order without logging command details.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Explorer beta signals are available only through opt-in local content-free records.
- Privacy-negative tests prove repository and editor content cannot cross the telemetry boundary.
