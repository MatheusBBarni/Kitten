---
status: pending
title: "SlashMenu presentational component"
type: frontend
complexity: medium
dependencies: []
---

# Task 06: SlashMenu presentational component

## Overview
Add a stateless `SlashMenu` component that renders grouped command rows (Cockpit first, then the focused agent) with a highlighted row, shortcut labels, and argument hints, as an absolutely-positioned box anchored above the prompt editor.
It holds no state and touches no store, so the editor (task_07) owns all behavior and this component stays trivially testable.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST define `MenuRow` (a cockpit row with label + shortcut, or an agent row with label + optional hint) and `SlashMenuProps` (grouped rows, highlighted index, `onSelect`) per the TechSpec "Core Interfaces" section.
- MUST render each group with a source header, cockpit rows showing the shortcut string, and agent rows showing the argument hint when present.
- MUST visually mark the highlighted row and expose activation through `onSelect(row)`.
- MUST render a clear, non-broken empty/no-match state.
- MUST be presentational only: no store subscriptions, no menu state, no `ControllerActions`, no `AgentConnection`.
</requirements>

## Subtasks
- [ ] 6.1 Define `MenuRow` and `SlashMenuProps`.
- [ ] 6.2 Render grouped rows with source headers.
- [ ] 6.3 Render the shortcut column (cockpit) and hint column (agent).
- [ ] 6.4 Apply highlight styling to the active row and wire `onSelect`.
- [ ] 6.5 Render the empty/no-match state.
- [ ] 6.6 Add render tests for structure, highlight, and empty state.

## Implementation Details
Follow the existing overlay components (`HandoffPreview`, `SessionsOverlay`) for the absolutely-positioned box and palette usage; the difference is that this box is non-modal and holds no state.
Cockpit row labels and shortcut strings come from `COCKPIT_KEYMAP` (assembled by the parent in task_07), so this component only renders what it is handed.
See the TechSpec "Implementation Design > Core Interfaces"; do not duplicate the row/props definitions here.

### Relevant Files
- `src/ui/HandoffPreview.tsx` / `src/ui/SessionsOverlay.tsx` - reference for absolute-box layout and theme palette usage.
- `src/ui/theme.ts` - palette tokens for headers, highlight, and muted hint text.
- `src/ui/keymap.ts` - source of the shortcut/description strings the parent maps into rows.

### Dependent Files
- `src/ui/PromptEditor.tsx` - task_07 renders `SlashMenu` with assembled, filtered groups.

### Related ADRs
- [ADR-004: Non-modal editor-local menu with a shared cockpit-command dispatcher](../adrs/adr-004.md) - the menu is a presentational overlay, not a store overlay.
- [ADR-001: Command menu V1 scope, trigger model, and state ownership](../adrs/adr-001.md) - grouping by source and cockpit-first ordering.

## Deliverables
- `src/ui/SlashMenu.tsx` presentational component with `MenuRow` and `SlashMenuProps`.
- Unit/render tests with 80%+ coverage **(REQUIRED)**
- A render test asserting the empty/no-match state **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] Given a Cockpit group with a hand-off row and an agent group with a `/review` row (hint "topic"), the painted frame shows both group headers, the hand-off row's shortcut `Ctrl+T`, and the `/review` hint text.
  - [ ] `highlightedIndex` of 0 renders the first row with the highlight style and other rows without it.
  - [ ] Empty `groups` renders a "no commands match" line rather than a blank box.
- Integration tests:
  - [ ] Rendered in the test renderer, activating the highlighted row calls `onSelect` with that exact row object.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The component holds no state and makes no store/controller calls.
- Groups render in order with cockpit-first, shortcuts, hints, and a non-broken empty state.
