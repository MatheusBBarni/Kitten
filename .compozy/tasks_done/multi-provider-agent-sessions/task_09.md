---
status: completed
title: "Attention and multi-session telemetry"
type: backend
complexity: medium
dependencies:
  - task_04
  - task_05
---

# Task 09: Attention and multi-session telemetry

## Overview
Extend the opt-in, content-free telemetry recorder with the counters that measure whether the fleet stays productive: attention latency, idle-fleet time, overview reliance, and multi-session adoption.
These feed the post-launch validation cohort in the PRD and never capture prompt, transcript, or path content.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST record, opt-in and content-free, the max concurrent sessions per run, the time from a session entering a needs-you state to the next user action (attention latency), the waiting time on unfocused sessions (idle-fleet), and the share of focus switches made through the Ctrl+S overview, per the TechSpec "Monitoring and Observability" section and the PRD Success Metrics.
- MUST carry only `sessionRef`, event type, and timestamp fields, never prompt, transcript, or path content.
- MUST be a no-op when telemetry is disabled, matching the existing recorder contract.
- SHOULD reuse the existing `TelemetryEvent` shape and the `recorder.watch(store)` subscription rather than adding a parallel path.
</requirements>

## Subtasks
- [x] 9.1 Record attention latency from a session entering needs-you to its next user action.
- [x] 9.2 Accumulate idle-fleet waiting time on unfocused sessions.
- [x] 9.3 Count focus switches made through the overview versus blind cycling, for overview reliance.
- [x] 9.4 Record the max concurrent sessions per run.
- [x] 9.5 Confirm every new counter is a no-op when telemetry is disabled.

## Implementation Details
Extend the recorder per the TechSpec "Monitoring and Observability" section, keeping the existing `TelemetryEvent` shape and `watch(store)` subscription.
The overview-reliance counter needs the jump/overview switch (task_05) distinguished from a blind `Ctrl+O`; attention latency reads the needs-you transition from the ADR-006 derivation.

### Relevant Files
- `src/telemetry/recorder.ts` - the recorder and its store subscription; add the new counters.
- `src/core/telemetryHeuristics.ts` - reusable measurement helpers if needed.
- `src/app/actions.ts` - mark a switch made through the overview versus a blind focus switch.

### Dependent Files
- `src/index.ts` - the recorder is created and wired at boot (unchanged wiring, new events).

### Related ADRs
- [ADR-006: Attention State Model and Jump-to-Next](../adrs/adr-006.md) - the needs-you transition that attention latency is measured from.

## Deliverables
- Content-free counters for attention latency, idle-fleet time, overview reliance, and max concurrent sessions.
- No-op behavior when telemetry is disabled.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests asserting a content-free attention event **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Attention latency is recorded as the delta from a session entering `awaiting_approval` to the next `respondPermission` for that session. (measured as the delta to the needs-you state resolving, i.e. the store transition the user action causes - the uniform store-derived signal across all needs-you states)
  - [x] A focus switch made through the overview increments the overview-reliance numerator while a blind `Ctrl+O` switch does not.
  - [x] Max concurrent sessions equals the number of live sessions in the run.
  - [x] With telemetry disabled, none of the new counters emit any event.
- Integration tests:
  - [x] With telemetry enabled, run a needs-you to action sequence and assert one attention-latency event carrying only `sessionRef`, `type`, and `at`, with no content fields.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Every new event is content-free and opt-in
- Disabled telemetry emits nothing
