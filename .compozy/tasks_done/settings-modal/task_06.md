---
status: completed
title: "Settings keymap bindings"
type: frontend
complexity: medium
dependencies: []
---

# Task 06: Settings keymap bindings

## Overview
Add the global chord that opens the settings modal and the modal's own internal keymap, keeping the keymap table the single source of truth for dispatch, help, and hints.
This gives later tasks a documented `open-settings` command and a settings-scoped keymap that follows the existing approval and hand-off overlay conventions.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add an `open-settings` command to the `CockpitCommand` union and a `COCKPIT_KEYMAP` binding for `Ctrl+,` (matcher for name `","` with `ctrl` and no other modifier).
- MUST add a `SettingsCommand` union and a `SETTINGS_KEYMAP` covering: move to previous/next option, switch tab, reset-to-default, and close, plus `matchSettingsCommand` and a `SETTINGS_HINT`, mirroring `APPROVAL_KEYMAP`/`HANDOFF_KEYMAP`.
- MUST surface the open-settings chord in `HELP_ENTRIES` (via the cockpit keymap) and update the status `KEYMAP_HINT` to include it.
- MUST document the `Ctrl+,` terminal-delivery caveat (not deliverable without the Kitty keyboard protocol) in the module comments.
- Global bindings MUST remain chords or function keys, never bare printables, per the module's stated rule.
</requirements>

## Subtasks
- [x] 6.1 Add `open-settings` to `CockpitCommand` and the `Ctrl+,` binding to `COCKPIT_KEYMAP`
- [x] 6.2 Add the `SettingsCommand` union and the `SETTINGS_KEYMAP` entries
- [x] 6.3 Add `matchSettingsCommand` and `SETTINGS_HINT`
- [x] 6.4 Ensure the open-settings chord flows into `HELP_ENTRIES` and `KEYMAP_HINT`
- [x] 6.5 Cover chord matching, modal command matching, and help/hint presence in tests

## Implementation Details
Modify `src/ui/keymap.ts`.
Follow the `APPROVAL_KEYMAP`/`HANDOFF_KEYMAP` and `matchApprovalCommand`/`matchHandoffCommand` patterns already in the module.
See the TechSpec "Core Interfaces" (keymap) section and the "Known Risks" note about `Ctrl+,`.

### Relevant Files
- `src/ui/keymap.ts` — `CockpitCommand`, `COCKPIT_KEYMAP`, per-overlay keymaps, matchers, hints

### Dependent Files
- `src/ui/CockpitApp.tsx` — task_10 dispatches `open-settings`
- `src/ui/SettingsView.tsx` — task_08 uses `SETTINGS_KEYMAP`, `matchSettingsCommand`, `SETTINGS_HINT`
- `src/ui/StatusStrip.tsx` — renders `KEYMAP_HINT`
- `src/ui/keymap.test.ts` — extend

### Related ADRs
- [ADR-002: Instant-apply, live-preview interaction model](../adrs/adr-002.md) — the modal's key behavior
- [ADR-004: Reactive, persisted configuration](../adrs/adr-004.md) — records the `Ctrl+,` caveat

## Deliverables
- An `open-settings` binding (`Ctrl+,`) and a settings-scoped keymap with matcher and hint
- Help and status hint reflecting the new chord, with the terminal caveat documented
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test asserting a synthesized `Ctrl+,` dispatches to `open-settings` only **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `matchCommand` for a `ctrl`+`","` key returns `"open-settings"`
  - [x] `matchCommand` for a plain `","` (no ctrl) returns `null` so the composer keeps the comma
  - [x] `matchSettingsCommand` maps up/down to prev/next option, the tab key to switch-tab, `"r"` to reset, and escape to close
  - [x] the open-settings chord appears in `HELP_ENTRIES`
  - [x] `KEYMAP_HINT` contains the settings chord
- Integration tests:
  - [x] a synthesized `Ctrl+,` `KeyEvent` routed through `matchCommand` yields `open-settings` and matches no other command
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The keymap table remains the single source for dispatch, help, and hints
- The `Ctrl+,` caveat is documented in the module
