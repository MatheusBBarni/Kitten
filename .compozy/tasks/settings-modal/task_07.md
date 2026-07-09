---
status: pending
title: "Content-free telemetry events for settings"
type: backend
complexity: medium
dependencies:
  - task_01
---

# Task 07: Content-free telemetry events for settings

## Overview
Extend the telemetry recorder with the content-free events the PRD success metrics need, so the wiring tasks can emit them.
Every new event preserves the recorder's structural no-text guarantee, recording only fixed enums and no user content.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add event types `settings_opened`, `theme_set`, `config_write`, and `config_write_error` to `TelemetryEventType`.
- MUST record the theme as a fixed enum (`themeId` drawn from `ThemePreference`) and the write source as a fixed enum (`modal`), never free text.
- MUST add a recorder method per event on `TelemetryRecorder`, implement them in `ActiveRecorder`, and add matching no-ops in `NOOP_RECORDER`.
- MUST keep every method a no-op when telemetry is disabled (the shared NOOP path opens no file).
- MUST NOT add any free-text field to `TelemetryRecord`.
</requirements>

## Subtasks
- [ ] 7.1 Add the four event types to `TelemetryEventType`
- [ ] 7.2 Add the fixed-enum `themeId`/`source` fields to `TelemetryRecord`
- [ ] 7.3 Add the recorder methods to the `TelemetryRecorder` interface
- [ ] 7.4 Implement them in `ActiveRecorder` and add no-ops to `NOOP_RECORDER`
- [ ] 7.5 Cover enabled emission, disabled no-op, and the content-free shape in tests

## Implementation Details
Modify `src/telemetry/recorder.ts`.
Follow the existing `handoffInvoked`/`handoffSent` method and `record()` helper pattern, and the `NOOP_RECORDER` structure.
See the TechSpec "Monitoring and Observability" section; the `themeId` enum comes from the `ThemePreference` type added in task_01.

### Relevant Files
- `src/telemetry/recorder.ts` — `TelemetryEventType`, `TelemetryRecord`, `TelemetryRecorder`, `ActiveRecorder`, `NOOP_RECORDER`

### Dependent Files
- `src/index.ts` — task_09 emits `theme_set` and `config_write`/`config_write_error`
- `src/ui/CockpitApp.tsx` — task_10 emits `settings_opened`
- `src/telemetry/recorder.test.ts` — extend

## Deliverables
- Four content-free event types with recorder methods and NOOP counterparts
- Fixed-enum `themeId`/`source` fields on `TelemetryRecord`, no text field added
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test emitting the four events into an injected in-memory sink **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] an enabled recorder writes a `settings_opened` record carrying only its type/timestamp/sessionRef
  - [ ] `themeSet("catppuccin-mocha")` writes a record with `themeId: "catppuccin-mocha"` and no text field
  - [ ] `configWrite("modal")` and `configWriteError("modal")` write records with the `source` enum
  - [ ] a disabled recorder writes nothing for all four methods
  - [ ] `TelemetryRecord` exposes no free-text content field (shape assertion)
- Integration tests:
  - [ ] with an injected in-memory sink, emitting the four events yields four content-free records
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The four events emit when enabled and no-op when disabled
- The content-free guarantee is preserved (no text field, fixed enums only)
