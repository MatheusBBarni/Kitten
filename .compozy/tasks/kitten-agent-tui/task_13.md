---
status: completed
title: "Telemetry recorder and heuristics"
type: backend
complexity: medium
dependencies:
  - task_02
  - task_05
  - task_12
---

# Task 13: Telemetry recorder and heuristics

## Overview
Implement the opt-in, content-free telemetry that records the honest metrics feeding the PRD kill-or-scale gate, including the re-explanation-eliminated heuristic.
It writes local JSONL only, never captures prompt or code content, and is a flagged prototype risk because the re-explanation heuristic needs tuning.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST record the metrics from the TechSpec "Monitoring and Observability" section: `handoff_invoked`, `handoff_sent`, `handoff_repeat`, `reexplanation_detected`, `bundle_edit_chars` (bucketed), `agent_ready`/`agent_unready`, and `first_response_ms`.
- MUST be opt-in: record nothing unless the config telemetry flag is enabled.
- MUST be content-free: never persist prompt or code text; store only counters, booleans, coarse buckets, and an anonymous session reference.
- MUST implement the re-explanation heuristic as a pure predicate: after a hand-off, a context-restating message to the target before its first tool call or edit flags `reexplanation_detected`, storing only the boolean and a char bucket.
- MUST write to a local JSONL file with no network calls.
</requirements>

## Subtasks
- [x] 13.1 Implement the opt-in gate driven by the config telemetry flag
- [x] 13.2 Implement the local JSONL recorder for the defined event set
- [x] 13.3 Implement the re-explanation heuristic predicate over post-hand-off events
- [x] 13.4 Emit hand-off, readiness, and first-response events from their sources
- [x] 13.5 Cover opt-in gating, content-free guarantees, and the heuristic with tests

## Implementation Details
Create the telemetry recorder and heuristic. See TechSpec "Monitoring and Observability" for the event set and the re-explanation heuristic, and PRD Success Metrics/privacy constraints. The heuristic is a pure predicate in the core; the recorder subscribes to store transitions (task_05) and hand-off events (task_12).

### Relevant Files
- `src/telemetry/recorder.ts` — new; opt-in local JSONL recorder
- `src/core/telemetryHeuristics.ts` — new; pure re-explanation predicate
- `src/telemetry/recorder.test.ts`, `src/core/telemetryHeuristics.test.ts` — new; tests

### Dependent Files
- `src/config/configLoader.ts` (task_04) — provides the telemetry opt-in flag
- `src/app/handoff.ts` (task_12) — emits hand-off lifecycle events

### Related ADRs
- [ADR-002: Validation-First Thin Slice for V1](adrs/adr-002.md) — these metrics drive the kill-or-scale gate

## Deliverables
- Opt-in, content-free telemetry recorder and the re-explanation heuristic
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test recording a hand-off session's events to JSONL **(REQUIRED)**

## Tests
- Unit tests:
  - [x] With telemetry disabled, no events are written for a full hand-off sequence
  - [x] With telemetry enabled, a hand-off writes `handoff_invoked` and `handoff_sent` events
  - [x] A recorded event contains no prompt or code text (content-free assertion over the serialized record)
  - [x] The heuristic flags `reexplanation_detected` when a long context-restating message precedes the target's first action, and does not flag when the target acts immediately
  - [x] `bundle_edit_chars` is stored as a coarse bucket, not an exact character count
- Integration tests:
  - [x] A scripted hand-off session with telemetry enabled produces the expected ordered JSONL events with no content fields
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Telemetry is off by default, content-free when on, and local-only
- The recorded metrics correspond to the PRD kill-or-scale thresholds
