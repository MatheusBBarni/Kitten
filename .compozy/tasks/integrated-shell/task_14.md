---
status: completed
title: "Discovery affordances and run-externally action"
type: frontend
complexity: medium
dependencies:
    - task_09
    - task_11
    - task_13
---

# Task 14: Discovery affordances and run-externally action

## Overview
Make the shell and its capabilities discoverable, and add the Kitten-observable proxy for leaving.
Surface the toggle-shell keybind in the status strip and the F1 help panel, and add a "run externally" action that copies a command out and records the intent, so context-switching away from the cockpit is measurable instead of invisible.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST show the toggle-shell keybind in the status strip hint and add its row to the F1 help panel, sourced from the keymap table so it cannot drift.
- MUST document the shell, its focus behavior, and the hand-off attach flow in the help panel.
- MUST add a "run externally" action available from the shell that surfaces the current command for running in an external terminal and records `external_run` (task_11).
- MUST keep the status strip readable and uncluttered, following its existing layout.
- SHOULD adapt or hide status chrome gracefully when the shell pane is full-height (task_10).

## Subtasks
- [ ] 14.1 Add the toggle-shell keybind to the status strip hint
- [ ] 14.2 Add the shell and attach-flow rows to the F1 help panel
- [ ] 14.3 Add the "run externally" action and its `external_run` recording
- [ ] 14.4 Keep the status strip layout readable
- [ ] 14.5 Adapt chrome when the pane is full-height

## Implementation Details
Modify `src/ui/StatusStrip.tsx`, `src/ui/keymap.ts` (`HELP_ENTRIES`, `KEYMAP_HINT`, and any shell hint), and `src/ui/CockpitApp.tsx` (help panel content is rendered from the keymap). See PRD "User Experience" (discovery) and "Success Metrics" (external-run proxy). The chord comes from task_09; the recorder method from task_11.

### Relevant Files
- `src/ui/StatusStrip.tsx` — the always-visible hint surface
- `src/ui/keymap.ts` — `HELP_ENTRIES`, `KEYMAP_HINT`, and the shell chord row
- `src/ui/CockpitApp.tsx` — `HelpOverlay` rendered from `HELP_ENTRIES`

### Dependent Files
- `src/telemetry/recorder.ts` — `external_run` emission (task_11)

### Related ADRs
- [ADR-005: In-Pane Interactive Apps, Pane Focus, and Ctrl+C Routing](adrs/adr-005.md) — the shell chord documented for discovery

## Deliverables
- Status-strip hint and F1 help coverage for the shell and attach flow
- A "run externally" action recording `external_run`
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for discovery and the proxy action **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] the status strip hint includes the toggle-shell keybind text
  - [ ] the F1 help panel lists the toggle-shell row sourced from the keymap
  - [ ] the "run externally" action records `external_run` exactly once per use
  - [ ] the help panel describes the hand-off attach flow
- Integration tests:
  - [ ] opening the help panel shows the shell and attach entries, and dismissing it returns focus without interrupting an agent
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The shell and its attach flow are discoverable without docs
- Leaving for an external terminal is recorded as a content-free proxy signal
