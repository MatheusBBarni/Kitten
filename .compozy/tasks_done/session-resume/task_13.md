---
status: completed
title: "Resume telemetry counters"
type: backend
complexity: medium
dependencies:
    - task_07
    - task_09
---

# Task 13: Resume telemetry counters

## Overview
The PRD success metrics need signal, so resume must emit content-free counters through the existing opt-in recorder.
This adds resume events for adoption, two-sided live fidelity, degradation frequency, and continue-without-re-explain, plus the picker and load timings.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST emit `session_resumed` with `{ mode: "picker" | "last-run", liveCount: 0 | 1 | 2 }` when a run is resumed.
- MUST emit `resume_pane_unavailable` with the agent when a pane restores as unavailable.
- MUST emit `resume_first_action` with `{ continued: boolean }` derived from the existing re-explanation heuristic on the first post-resume message.
- MUST record timings for picker-open-to-interactive and load-to-usable-cockpit.
- MUST remain content-free (no prompt text) and be a no-op when telemetry is disabled, consistent with the current recorder.

## Subtasks
- [ ] 13.1 Add resume event methods to the recorder
- [ ] 13.2 Emit `session_resumed` and `resume_pane_unavailable` from the restore path
- [ ] 13.3 Emit `resume_first_action` via the re-explanation heuristic
- [ ] 13.4 Record picker-open and load-settle timings
- [ ] 13.5 Cover event emission, content-free payloads, and disabled no-op in tests

## Implementation Details
Modify `src/telemetry/recorder.ts` (recorder API and event types) and emit from `src/app/controller.ts` (restore, task_07) and `src/ui/SessionPicker.tsx` (mode/timing, task_09).
Reuse `src/core/telemetryHeuristics.ts` for the re-explanation classification; see the TechSpec "Monitoring and Observability" section and ADR-002.

### Relevant Files
- `src/telemetry/recorder.ts` — recorder API, `TelemetryRecord` types, the disabled `NOOP_RECORDER`
- `src/core/telemetryHeuristics.ts` — the re-explanation heuristic for `resume_first_action`
- `src/app/controller.ts` — restore path emits resume/unavailable events (task_07)
- `src/ui/SessionPicker.tsx` — resume mode and picker timing (task_09)

### Dependent Files
- `src/telemetry/recorder.test.ts`, `src/core/telemetryHeuristics.test.ts` — extend for the new events

### Related ADRs
- [ADR-002: V1 Rollout Shape](../adrs/adr-002.md) — success metrics tracked via opt-in, content-free telemetry

## Deliverables
- Resume event methods on the recorder and their emission points
- Picker and load timing capture
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test that a full resume emits the expected content-free events **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] resuming with both panes live records `session_resumed` with `liveCount: 2`
  - [ ] an unavailable `codex` pane records `resume_pane_unavailable` with `agent: "codex"`
  - [ ] a first post-resume message classified as continuation records `resume_first_action` with `continued: true`
  - [ ] a disabled recorder records nothing across a full resume
  - [ ] no emitted event carries prompt text (payloads are content-free)
- Integration tests:
  - [ ] a full picker-driven resume emits `session_resumed` (mode "picker") and, on a degraded pane, `resume_pane_unavailable`
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Resume emits the metric-backing events, content-free, and nothing when telemetry is off
