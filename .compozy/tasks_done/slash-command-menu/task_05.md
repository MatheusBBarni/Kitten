---
status: completed
title: "Extract runCockpitCommand dispatcher and thread onRunCommand"
type: refactor
complexity: medium
dependencies: []
---

# Task 05: Extract runCockpitCommand dispatcher and thread onRunCommand

## Overview
Refactor `CockpitFrame`'s `onKey` switch into a single `runCockpitCommand(command)` function used by both the keyboard handler and, later, the slash menu, and add an `onRunCommand` prop to `PromptEditor`.
This gives the menu one dispatch path to the cockpit actions that live in the frame's scope (the hand-off flow, help state, store) without duplicating dispatch logic. The change is behavior-preserving.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST extract the cockpit-command dispatch from `CockpitFrame.onKey` into a `runCockpitCommand(command: CockpitCommand): void` that `onKey` calls, preserving the exact current behavior of every command (switch-focus, hand-off, sessions, toggle-help, close-help).
- MUST add an `onRunCommand: (command: CockpitCommand) => void` prop to `PromptEditor`, wired from `CockpitFrame` to `runCockpitCommand` (accepted now; consumed by task_07).
- MUST route each command to its existing owner (`controller.actions`, `controller.store`, the `handoff` flow, and shell help state) with no change in effect or ordering.
- MUST NOT alter existing chord behavior or the `overlayOpen` early-return.
</requirements>

## Subtasks
- [ ] 5.1 Extract the `onKey` command switch into `runCockpitCommand`.
- [ ] 5.2 Call `runCockpitCommand` from `onKey` for the matched command.
- [ ] 5.3 Add the `onRunCommand` prop to `PromptEditor` and pass `runCockpitCommand` from `CockpitFrame`.
- [ ] 5.4 Keep existing `CockpitApp` tests green and add coverage for the extracted dispatcher.

## Implementation Details
The dispatcher centralizes the four owners the menu must reach; `handoff` and help state are only in scope inside `CockpitFrame`, which is why the menu receives a callback rather than reaching them directly.
See the TechSpec "Implementation Design > Core Interfaces" (the `runCockpitCommand` sketch) and ADR-004; do not duplicate the switch here.

### Relevant Files
- `src/ui/CockpitApp.tsx` - holds `CockpitFrame.onKey`, the `handoff` flow instance, help `useState`, and the `overlayOpen` guard.
- `src/ui/PromptEditor.tsx` - gains the `onRunCommand` prop (unused until task_07).
- `src/ui/CockpitApp.test.tsx` - drives the frame via the fake controller and recorded calls.

### Dependent Files
- `src/ui/PromptEditor.tsx` - task_07 calls `onRunCommand` on a cockpit selection.

### Related ADRs
- [ADR-004: Non-modal editor-local menu with a shared cockpit-command dispatcher](../adrs/adr-004.md) - mandates a single dispatch path shared by chords and the menu.

## Deliverables
- `runCockpitCommand` extracted and called from `onKey`.
- `onRunCommand` prop on `PromptEditor`, wired from `CockpitFrame`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Behavior-preserving regression tests for the existing chords **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `runCockpitCommand("switch-focus")` calls `controller.actions.switchFocus`.
  - [ ] `runCockpitCommand("hand-off")` invokes the hand-off flow's `begin` and closes the help panel.
  - [ ] `runCockpitCommand("sessions")` opens the sessions overview and closes the help panel.
  - [ ] `runCockpitCommand("toggle-help")` flips the help-open state.
- Integration tests:
  - [ ] Pressing Ctrl+T through the mounted cockpit still triggers the hand-off (regression: routed via the extracted dispatcher).
  - [ ] Pressing Ctrl+O still switches focus.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Existing `CockpitApp` chord tests pass unchanged (behavior-preserving).
- `PromptEditor` accepts `onRunCommand` and receives `runCockpitCommand`.
