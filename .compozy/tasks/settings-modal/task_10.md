---
status: completed
title: "Shell integration for the settings modal"
type: frontend
complexity: medium
dependencies:
  - task_06
  - task_07
  - task_08
---

# Task 10: Shell integration for the settings modal

## Overview
Connect the modal to the cockpit shell: dispatch the open-settings chord to open the store slot, mount `SettingsView` so a pending approval still outranks it, surface the chord in the status hint, and record `settings_opened`.
This is the final wiring that makes the settings modal reachable and discoverable in the running cockpit.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST handle the `open-settings` command in `CockpitFrame`'s `onKey` by closing the help panel and calling `openSettings`, and MUST record `settings_opened`.
- MUST mount `<SettingsView />` in the frame directly below `<ApprovalPrompt />` so a pending permission request still paints on top.
- MUST rely on `selectHasOpenOverlay` (already including the settings slot) so the shell stands down and the composer releases focus while the modal is open.
- MUST surface the settings chord in the status strip hint and help panel, which already derive from the keymap table.
- MUST keep the existing overlay precedence and key-dispatch behavior intact.
</requirements>

## Subtasks
- [x] 10.1 Add an `open-settings` case to the `CockpitFrame` `onKey` switch that closes help and opens settings
- [x] 10.2 Record `settings_opened` when the modal opens
- [x] 10.3 Mount `<SettingsView />` directly below `<ApprovalPrompt />`
- [x] 10.4 Confirm the status hint and help panel show the settings chord
- [x] 10.5 Cover dispatch, mount order, and focus stand-down in tests

## Implementation Details
Modify `src/ui/CockpitApp.tsx` (add the `matchCommand` case and mount `<SettingsView />`) and `src/ui/StatusStrip.tsx` if the hint is not already fully derived from the keymap table.
Follow the existing `matchCommand` switch and the overlay mount ordering (`ApprovalPrompt` stays last).
See the TechSpec "System Architecture" (shell wiring) section and ADR-002.

### Relevant Files
- `src/ui/CockpitApp.tsx` — the `onKey` dispatch switch and the overlay mount order
- `src/ui/StatusStrip.tsx` — the always-visible keymap hint

### Dependent Files
- `src/ui/SettingsView.tsx` (task_08) — mounted here
- `src/ui/keymap.ts` (task_06) — provides `open-settings`
- `src/telemetry/recorder.ts` (task_07) — records `settings_opened`
- `src/ui/CockpitApp.test.tsx` and its snapshot — update

### Related ADRs
- [ADR-002: Instant-apply, live-preview interaction model](../adrs/adr-002.md) — open behavior and precedence

## Deliverables
- Open-settings dispatch, `SettingsView` mounted with correct precedence, and the status/help hint
- `settings_opened` recorded on open, with existing overlay behavior unchanged
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test opening the modal via `Ctrl+,` and closing it with Escape **(REQUIRED)**

## Tests
- Unit tests:
  - [x] dispatching `Ctrl+,` opens the settings slot (`openSettings` called) and records `settings_opened`
  - [x] opening settings closes an open help panel
  - [x] `SettingsView` is mounted below `ApprovalPrompt` in the frame tree (order assertion)
  - [x] while settings is open, the shell's other chords (switch-focus, hand-off) do not fire
- Integration tests:
  - [x] `Ctrl+,` opens the modal, the composer loses focus (`selectHasOpenOverlay` true), and Escape closes it and restores focus
  - [x] a `CockpitApp` snapshot with the settings modal open matches
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The modal opens via `Ctrl+,`, is discoverable in the hint/help, and yields to approval
- Existing overlay precedence and dispatch behavior are unchanged
