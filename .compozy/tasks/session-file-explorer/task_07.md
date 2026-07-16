---
status: pending
title: Explorer Command Registry, Keyboard Tree, and Responsive Presentation
type: frontend
complexity: high
---

# Task 7: Explorer Command Registry, Keyboard Tree, and Responsive Presentation

## Overview

Add the file explorer as a docked, focusable cockpit surface with command, keyboard, tree-navigation, and responsive layout behavior. The view must remain a rendering and action-dispatch layer, leaving all I/O and mutation in the controller and store.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- `/file-explorer` and Ctrl+B MUST invoke the same visible command and appear in existing command/help surfaces exactly once.
- Explorer keys MUST operate only while explorer focus is active; approval and clarification overlays retain higher priority.
- Tree navigation MUST provide arrows, Enter, refresh, Escape, and selection behavior without importing Node I/O.
- Layout MUST dock beside the conversation when space permits and fall back to a full-width focused pane when it does not.
</requirements>

## Subtasks

- [ ] 7.1 Add a single explorer command entry, slash dispatch, and global Ctrl+B shortcut.
- [ ] 7.2 Create a presentational FileExplorer using store selectors and controller actions.
- [ ] 7.3 Add focus-scoped tree keyboard behavior and fixed-notice rendering.
- [ ] 7.4 Compose docked and narrow-screen layouts in the cockpit frame.
- [ ] 7.5 Preserve overlay precedence and Escape focus return behavior.
- [ ] 7.6 Cover command, keyboard, layout, and session-restoration scenarios.

## Implementation Details

Follow the TechSpec “UI Composition,” “Keyboard and Command Map,” and “Accessibility” sections. Use the central `COCKPIT_COMMANDS` and `CockpitApp` dimension ownership patterns; keep `FileExplorer` declarative and route mutations through `ControllerActions`.

### Relevant Files

- `src/ui/CockpitApp.tsx` — owns command dispatch, dimensions, overlays, and frame composition.
- `src/ui/CockpitApp.test.tsx` — existing render, overlay, and responsive-layout tests.
- `src/ui/keymap.ts` — central global and focus-scoped key handling.
- `src/ui/keymap.test.ts` — current shortcut and precedence test conventions.
- `src/ui/PromptEditor.tsx` — existing slash command dispatch integration point.
- `src/ui/cockpitContext.tsx` — controller action access pattern for views.

### Dependent Files

- `src/ui/FileExplorer.tsx` — new presentational explorer surface.
- `src/ui/FileExplorer.test.tsx` — new component and interaction tests.
- `src/store/selectors.ts` — provides session-scoped explorer view state.

### Related ADRs

- [ADR-001: Keep a safety-complete session explorer as the V1 boundary](adrs/adr-001.md) — limits UI capabilities to inspect and open.
- [ADR-002: Validate repeat multi-session use before expanding the explorer](adrs/adr-002.md) — requires obvious session-scoped behavior.
- [ADR-003: Keep explorer I/O behind separate controller-owned capabilities](adrs/adr-003.md) — prohibits UI-layer filesystem and process access.

## Deliverables

- Unified command and shortcut entry points for the explorer.
- Focus-scoped, accessible tree UI with responsive docked and narrow layouts.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for command-to-action and overlay-priority behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Ctrl+B and `/file-explorer` invoke the same action and help entry appears once.
  - [ ] Arrow keys, Right, Left, Enter, R, and Escape have their specified focused-tree behavior.
  - [ ] Explorer keys do nothing when another cockpit region owns focus.
  - [ ] File rows expose the required path, kind, selected, expanded, and disabled semantics.
- Integration tests:
  - [ ] Approval and clarification overlays consume their keys before explorer handlers.
  - [ ] Wide dimensions render a docked explorer; narrow dimensions render the focused full-width fallback.
  - [ ] Switching sessions restores each session’s explorer presentation state.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Both entry points reach one explorer command implementation.
- The UI is keyboard-operable and performs no filesystem or process I/O.
