---
status: completed
title: "Menu navigation keymap and footer hint"
type: frontend
complexity: medium
dependencies: []
---

# Task 04: Menu navigation keymap and footer hint

## Overview
Add the slash menu's own navigation keymap and matcher, and extend the status-strip hint to teach the hand-off and the `/` menu.
Keeping the menu's keys and the footer copy in the single keymap table honors the repo rule that bindings and their help text never drift.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a `MenuCommand` union and a `MENU_KEYMAP` covering menu navigation (previous/next item, confirm, dismiss, and the token-completion key) plus a `matchMenuCommand`, mirroring `SESSIONS_KEYMAP` and `matchSessionsCommand`.
- MUST extend `KEYMAP_HINT` so the status strip teaches the hand-off and the `/` menu while remaining a single line.
- MUST update `keymap.test.ts` to assert the new keymap's command list and per-command uniqueness, and that `KEYMAP_HINT` advertises the hand-off and `/`.
- MUST NOT add a bare-printable global binding; the `/` trigger is detected in the editor (task_07), not dispatched from this table.
</requirements>

## Subtasks
- [x] 4.1 Define the `MenuCommand` union and `MENU_KEYMAP` entries with plain navigation keys.
- [x] 4.2 Add `matchMenuCommand` via the existing `makeMatcher`.
- [x] 4.3 Extend `KEYMAP_HINT` to include the hand-off and `/` menu.
- [x] 4.4 Update `keymap.test.ts` for the new keymap and hint.

## Implementation Details
Mirror the modal-keymap pattern (`SESSIONS_KEYMAP` + `matchSessionsCommand` + its hint constant).
The menu keymap is matched only while the menu is armed inside the editor's `onKeyDown` (task_07), the same way the modal keymaps are matched inside their overlays.
See the TechSpec "System Architecture > Component Overview" (menu keymap + footer); do not duplicate the entries here.

### Relevant Files
- `src/ui/keymap.ts` - holds `SESSIONS_KEYMAP` (template), `makeMatcher`, `KEYMAP_HINT`, and the `CockpitKey` matcher helpers.
- `src/ui/keymap.test.ts` - asserts each keymap's command list and uniqueness.

### Dependent Files
- `src/ui/PromptEditor.tsx` - task_07 uses `matchMenuCommand` for armed key capture.
- `src/ui/SlashMenu.tsx` - task_06 renders rows whose labels/shortcuts come from `COCKPIT_KEYMAP`.
- `src/ui/StatusStrip.tsx` - renders the extended `KEYMAP_HINT` with no change of its own.

### Related ADRs
- [ADR-004: Non-modal editor-local menu with a shared cockpit-command dispatcher](../adrs/adr-004.md) - defines the menu keymap and footer approach.
- [ADR-001: Command menu V1 scope, trigger model, and state ownership](../adrs/adr-001.md) - the `/` trigger is editor-detected, not a global binding.

## Deliverables
- `MenuCommand`, `MENU_KEYMAP`, and `matchMenuCommand`.
- Extended `KEYMAP_HINT`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Keymap-table assertions covering the new command list and hint **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `MENU_KEYMAP` exposes exactly the expected menu commands and each command appears once (uniqueness).
  - [x] `matchMenuCommand` returns the next-item command for a Down key and `null` for an unmapped key (e.g. a bare letter).
  - [x] `KEYMAP_HINT` contains the hand-off chord (`^T`) and the `/` menu marker.
- Integration tests:
  - [x] None at this layer - the keymap is a pure table; armed dispatch through it is exercised by task_07's interaction tests.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The status strip remains a single line and advertises the hand-off and `/`.
- No bare-printable global binding was added.
