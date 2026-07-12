---
status: completed
title: "Telemetry recorder surface for shell events"
type: backend
complexity: low
dependencies:
    - task_01
---

# Task 11: Telemetry recorder surface for shell events

## Overview
Add the content-free telemetry events the integrated shell needs, so the feature's effect on context-switching is measurable.
Extend the recorder with `shell_activated`, `shell_snapshot_attached`, and `external_run` event types and the methods that emit them, preserving the opt-in, content-free, local-only guarantees.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `shell_activated`, `shell_snapshot_attached`, and `external_run` to `TelemetryEventType`.
- MUST add corresponding recorder methods that write only content-free records (type, timestamp, anonymous `sessionRef`, optional coarse buckets), never command text.
- MUST keep every method a no-op on the disabled recorder, matching `NOOP_RECORDER`.
- MUST leave the existing hand-off and readiness metrics unchanged.
- SHOULD document that the existing `reexplanation_detected` metric doubles as the moat signal, split by whether a snapshot was attached.

## Subtasks
- [ ] 11.1 Extend `TelemetryEventType` with the three shell events
- [ ] 11.2 Add recorder methods emitting content-free records
- [ ] 11.3 Mirror the methods as no-ops on the disabled recorder
- [ ] 11.4 Confirm no text field can be recorded

## Implementation Details
Modify `src/telemetry/recorder.ts`. Follow the existing event-union and `record()` stamping pattern, and the `NOOP_RECORDER` mirror. See TechSpec "Monitoring and Observability" for the event set. Emission call sites live in tasks 09, 13, and 14, which depend on this surface.

### Relevant Files
- `src/telemetry/recorder.ts` — the event union, `ActiveRecorder`, and `NOOP_RECORDER` to extend
- `src/telemetry/recorder.test.ts` — recorder test conventions
- `src/core/types.ts` — `TelemetryEvent` shape

### Dependent Files
- `src/ui/CockpitApp.tsx` — emits `shell_activated` (task_09)
- `src/app/handoff.ts` / `src/ui/HandoffPreview.tsx` — emits `shell_snapshot_attached` (task_13)
- `src/ui/StatusStrip.tsx` — emits `external_run` (task_14)

### Related ADRs
- [ADR-002: Ship the Full Cockpit Shell in One Release, With Interactive-App Takeover in the MVP](adrs/adr-002.md) — the kill-or-scale gate the metrics feed

## Deliverables
- Three new content-free telemetry event types and their recorder methods
- No-op parity on the disabled recorder
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for sink output **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] the `shell_activated` method writes a record with the correct type and no text field
  - [ ] the `shell_snapshot_attached` method writes a content-free record
  - [ ] the `external_run` method writes a content-free record
  - [ ] every new method is a no-op on the disabled recorder (nothing written)
- Integration tests:
  - [ ] the three methods append well-formed JSONL lines to the sink with only allowed fields
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- New events are content-free and opt-in, with no-op parity when disabled
- Existing metrics remain unchanged
