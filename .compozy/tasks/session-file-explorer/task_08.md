---
status: completed
title: Settings Editor Draft and Explicit Save/Cancel UX
type: frontend
complexity: medium
---

# Task 8: Settings Editor Draft and Explicit Save/Cancel UX

## Overview

Add an Editor tab to settings for choosing the system default or a validated custom editor. The interface must use a local draft so Cancel and Escape discard all changes, while Save calls the configured persistence action and visibly preserves any failure.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- The Editor tab MUST offer `System Default` and `Custom` modes with executable and argument editing only in Custom mode.
- Custom draft validation MUST require exactly one full `{file}` argument and retain invalid input for correction.
- Save MUST call the configured persistence action; Cancel and Escape MUST discard the draft without a write.
- A watcher update MUST refresh the settled preference only and MUST NOT overwrite an active local draft.
</requirements>

## Subtasks

- [ ] 8.1 Extend the settings tab model with an Editor section.
- [ ] 8.2 Render system-default and custom-editor draft controls with clear validation feedback.
- [ ] 8.3 Connect Save to the configured action and present a fixed save failure state.
- [ ] 8.4 Implement Cancel and Escape draft discard behavior.
- [ ] 8.5 Keep watcher updates isolated from an active draft and add UI coverage.

## Implementation Details

Follow the TechSpec “Settings UX State Machine,” “Accessibility,” and “Configuration Contract” sections. Retain the existing settings local-state and snapshot-testing style; do not parse config or launch processes from the view.

### Relevant Files

- `src/ui/SettingsView.tsx` — current settings tabs, local draft conventions, and action wiring.
- `src/ui/SettingsView.test.tsx` — current settings interaction and snapshot coverage.
- `src/ui/keymap.ts` — existing Escape precedence that the view must respect.

### Dependent Files

- `src/index.ts` — provides the explicit save action and settled runtime preference.
- `src/config/configLoader.ts` — supplies the validated preference shape and error constraints.
- `src/app/controller.ts` — receives saved preferences for subsequent opens.

### Related ADRs

- [ADR-004: Persist editor preferences as validated direct argument vectors](adrs/adr-004.md) — defines strict custom editor and explicit Save/Cancel behavior.

## Deliverables

- Editor settings tab with system-default and custom drafts.
- Exact-placeholder validation, Save feedback, and Cancel/Escape discard behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for settings-to-runtime persistence **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] System Default initializes from the settled preference and saves without custom fields.
  - [ ] Custom mode accepts an executable plus arguments containing exactly one `{file}` token.
  - [ ] Missing, repeated, or partial placeholders show validation feedback and do not call Save.
  - [ ] Cancel and Escape discard changed executable and argument draft values without a write.
  - [ ] Save failure retains the draft and displays the fixed failure state.
- Integration tests:
  - [ ] An external config reload updates an idle Editor tab but does not overwrite an active draft.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Users can deliberately save, cancel, or correct an editor preference without side effects.
- No settings interaction can produce an invalid persisted command vector.
