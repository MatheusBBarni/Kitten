---
status: pending
title: "Task 03: Opt-in file-selector telemetry through controller actions"
type: backend
complexity: high
---

# Task 03: Opt-in file-selector telemetry through controller actions

## Overview

Extend the existing local telemetry recorder and controller action facade with the content-free signals required to evaluate @ File Selector adoption, latency, completion, and correction. The recorder receives only fixed event kinds, session identity, duration, and outcome; PromptEditor will own all clocks and reference-range lifecycle in task_06.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add closed, opt-in recorder support for opened, discovery, warm-query-rendered, selected, and corrected file-selector events.
2. MUST permit only the existing anonymous session reference, addressed session id, fixed event/outcome values, and duration fields.
3. MUST NOT record candidate paths, query text, prompt text, candidate counts, source bytes, or reference text.
4. MUST expose a narrow controller action telemetry facade that task_06 can call without importing the recorder into the UI.
5. MUST preserve no-op behavior and zero writes when `telemetryEnabled` is false.
</requirements>

## Subtasks
- [ ] 3.1 Extend the telemetry event and record contracts with fixed file-selector signals.
- [ ] 3.2 Add recorder methods and disabled-recorder implementations.
- [ ] 3.3 Wire a narrow file-selector telemetry facade through actions and controller construction.
- [ ] 3.4 Add deterministic enabled and disabled recorder coverage.
- [ ] 3.5 Prove the serialized event shape cannot contain prohibited content fields.

## Implementation Details

Use TechSpec "Monitoring and Observability" as the event inventory and "Data Models" for privacy limits. Keep lifecycle state out of the recorder: it records facts supplied by the UI through `ControllerActions`.

### Relevant Files
- `src/telemetry/recorder.ts` — closed event union, record shape, no-op recorder, active implementation.
- `src/telemetry/recorder.test.ts` — injected clock/sink tests for content-free local telemetry.
- `src/app/actions.ts` — existing narrow telemetry interfaces and UI action surface.
- `src/app/controller.ts` — injects the recorder into action construction.
- `src/app/controller.test.ts` — validates production wiring with recorder doubles.

### Dependent Files
- `test/fakeController.ts` — task_06 needs a recording fake for UI telemetry assertions.
- `src/ui/PromptEditor.tsx` — task_06 reports only content-free interaction facts.
- `.compozy/tasks/file-selector-at/_techspec.md` — defines warm-query and correction semantics that callers must satisfy.

### Related ADRs
- [ADR-001: Keep @ File Selection as an Honest, On-Demand Single-File Reference](adrs/adr-001.md) — requires opt-in, content-free usage measurement.
- [ADR-003: Discover Repository Files Through an Injected Controller-Owned Git Source](adrs/adr-003.md) — keeps discovery failure and latency visible without leaking paths.
- [ADR-004: Keep @ Completion Local to the Prompt Token](adrs/adr-004.md) — assigns interaction lifecycle to the editor, not the recorder.

## Deliverables
- Extended `TelemetryEventType`, `TelemetryRecord`, and `TelemetryRecorder` contracts.
- Controller/action telemetry facade for file-selector facts.
- Recorder and controller tests for enabled, disabled, and privacy-safe behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for recorder-to-controller action telemetry wiring **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Each fixed file-selector event records the expected event kind, agent id, duration, and fixed outcome/state only.
  - [ ] Disabled telemetry records no event and constructs no sink writes for every new method.
  - [ ] Serialized records lack query, path, prompt, candidate-count, reference-text, and byte fields.
  - [ ] Invalid or non-fixed outcome values are not accepted by the typed recorder API.
- Integration tests:
  - [ ] A controller built with an enabled injected recorder forwards a file-selector action fact to the sink.
  - [ ] The same controller built with telemetry disabled emits no sink record while other controller actions remain functional.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- All five PRD measurement signals are available only behind the existing opt-in gate.
- The UI can record metrics through controller actions without importing telemetry internals.
