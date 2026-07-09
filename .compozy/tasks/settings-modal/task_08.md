---
status: pending
title: "Settings modal component"
type: frontend
complexity: high
dependencies:
  - task_02
  - task_03
  - task_06
---

# Task 08: Settings modal component

## Overview
Build the settings overlay: a tabbed, keyboard-captured modal whose Theme tab lets the user arrow through themes with the real cockpit repainting live and the choice persisting on selection.
It supports reset-to-default, a live-vs-restart label, and yields to a pending approval, following the existing overlay pattern.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST render as an absolutely-positioned overlay that mounts only when the settings slot is open and captures the keyboard with `preventDefault`, following the `ApprovalPrompt`/`HandoffPreview` pattern.
- MUST render nothing while the approval overlay is open, so a pending permission request outranks settings.
- MUST present the Theme tab listing `auto`, `light`, `dark`, `catppuccin-mocha`, and `catppuccin-latte`, marking the current one; moving the selection MUST call `setThemePreference` so the cockpit repaints live.
- MUST support reset-to-default (return the theme to `"auto"`) and close on Escape via `closeSettings`.
- MUST show a live-vs-restart label indicating the theme applies immediately, render the `SETTINGS_HINT` footer, and use only palette tokens (no hard-coded colors).
</requirements>

## Subtasks
- [ ] 8.1 Scaffold `SettingsView` as a self-gating, keyboard-capturing overlay
- [ ] 8.2 Make it render nothing while an approval is open
- [ ] 8.3 Build the Theme tab listing the registry options with the current one marked
- [ ] 8.4 Apply the selection live via `setThemePreference` and support reset-to-default
- [ ] 8.5 Add the live-vs-restart label and the `SETTINGS_HINT` footer, close on Escape
- [ ] 8.6 Cover render gating, live apply, reset, and close in component tests

## Implementation Details
Create `src/ui/SettingsView.tsx`.
Reuse the `HandoffPreview` overlay structure (`useKeyboard` + `preventDefault`, absolute positioning, yielding to the approval overlay) and `ApprovalPrompt` gating.
Read the theme options from the registry (task_03), drive the store via task_02 actions, and match keys via task_06.
See the TechSpec "System Architecture" (SettingsView) section and ADR-002.

### Relevant Files
- `src/ui/SettingsView.tsx` — new; the modal component
- `src/ui/ApprovalPrompt.tsx`, `src/ui/HandoffPreview.tsx` — overlay and precedence patterns to mirror
- `src/ui/theme.ts` — palette tokens and the registry list
- `src/ui/keymap.ts` — `SETTINGS_KEYMAP`, `matchSettingsCommand`, `SETTINGS_HINT`

### Dependent Files
- `src/ui/CockpitApp.tsx` — task_10 mounts `<SettingsView />`
- `src/ui/SettingsView.test.tsx` and its snapshot — new

### Related ADRs
- [ADR-002: Instant-apply, live-preview interaction model](../adrs/adr-002.md) — apply-on-navigation, reset, tabs
- [ADR-003: Include 1-2 named theme presets in V1](../adrs/adr-003.md) — the preset options listed
- [ADR-005: Theme override via a palette registry](../adrs/adr-005.md) — the option source

## Deliverables
- A `SettingsView` overlay with a live-applying Theme tab, reset-to-default, and Escape-to-close
- Correct modality (keyboard capture, yields to approval, palette tokens only)
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test asserting a live cockpit repaint while navigating themes **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] renders nothing when the settings slot is `null`
  - [ ] renders nothing when an approval is open even though settings is open
  - [ ] the Theme tab lists all five options with the current preference marked
  - [ ] moving down then selecting calls `setThemePreference` with the next option
  - [ ] reset returns the preference to `"auto"`
  - [ ] Escape calls `closeSettings`
  - [ ] the Theme tab shows the "applies immediately" label
- Integration tests:
  - [ ] opening settings and arrowing through themes changes the resolved palette live via the store
  - [ ] a snapshot of the open Theme tab matches
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The modal applies themes live, persists via the store, resets, and yields to approval
- Rendering uses only palette tokens and follows the overlay pattern
