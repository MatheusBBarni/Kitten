---
status: completed
title: "Switch telemetry and kept-change heuristic"
type: backend
complexity: medium
dependencies:
  - task_04
  - task_05
  - task_08
---

# Task 09: Switch telemetry and kept-change heuristic

## Overview
Add the opt-in, content-free counters that make the PRD success metrics measurable: switches attempted and confirmed, effort changes kept through the next turn, and hand-offs paired with a model or effort change.
These reuse the existing telemetry recorder and heuristics and record no prompt or code content.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add content-free counters `model_switched`, `effort_switched`, `switch_confirmed`, `switch_unverified`, and `effort_linked_handoff` to the recorder, following the existing `TelemetryEventType`/`record` pattern.
- MUST record a switch as confirmed or unverified based on the adapter-reported result (per ADR-004), never on the request alone.
- MUST implement a kept-change heuristic (`effort_change_kept`) that fires when an effort change survives to the pane's next turn, as a pure predicate over events.
- MUST record `effort_linked_handoff` when a hand-off carries a non-empty `targetConfig` (task_08).
- MUST remain opt-in and off by default, storing only counters, buckets, and agent ids (no text), including a no-op in `NOOP_RECORDER`.
</requirements>

## Subtasks
- [x] 9.1 Add the new event types and recorder methods, plus their `NOOP_RECORDER` no-ops
- [x] 9.2 Record confirmed vs unverified from the switch result
- [x] 9.3 Implement the pure `effort_change_kept` predicate in the heuristics module
- [x] 9.4 Record `effort_linked_handoff` from the hand-off flow
- [x] 9.5 Cover the counters and heuristic with an in-memory sink

## Implementation Details
Modify the recorder and heuristics. See TechSpec "Monitoring and Observability" and PRD "Success Metrics". Follow the content-free `record` pattern (`recorder.ts:159-173`, `239-241`), the `TelemetryEventType` union (`35-43`), and reuse `bucketChars`/predicate style in `telemetryHeuristics.ts`.

### Relevant Files
- `src/telemetry/recorder.ts` — `TelemetryEventType` (35-43), `TelemetryRecorder` (78-94), `ActiveRecorder`/`record` (143-242), `NOOP_RECORDER` (111-120)
- `src/core/telemetryHeuristics.ts` — pure predicates (e.g. `detectReexplanation` 92-103) to mirror for kept-change
- `src/telemetry/recorder.test.ts`, `src/core/telemetryHeuristics.test.ts` — sink-injected tests

### Dependent Files
- `src/app/actions.ts` (task_05) — the switch action triggers switch counters
- `src/app/handoff.ts` (task_08) — the hand-off flow triggers `effort_linked_handoff`

### Related ADRs
- [ADR-004: Live in-place switching with confirmed-state UI and a category allowlist](adrs/adr-004.md) — confirmed vs unverified counters follow the reported result
- [ADR-001: V1 scope](adrs/adr-001.md) — the blended success metrics this task measures

## Deliverables
- Content-free switch counters and the kept-change heuristic
- Recording of effort-linked hand-offs
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test asserting counters flow to an injected sink **(REQUIRED)**

## Tests
- Unit tests:
  - [x] A confirmed model switch records `model_switched` and `switch_confirmed` with the agent id and no text field
  - [x] An unverified switch records `switch_unverified`, not `switch_confirmed`
  - [x] `effort_change_kept` fires when an effort change is followed by a next turn with no revert, and does not fire when the effort is reverted first
  - [x] `effort_linked_handoff` records only when the hand-off `targetConfig` is non-empty
  - [x] With telemetry disabled (`NOOP_RECORDER`), no records are written
- Integration tests:
  - [x] Driving a switch and an effort-tagged hand-off with an injected in-memory sink produces the expected sequence of content-free records
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The PRD metrics (confirmed-applied, kept effort-change, effort-linked hand-offs) are measurable from content-free counters
- Telemetry stays opt-in and records no prompt or code content
