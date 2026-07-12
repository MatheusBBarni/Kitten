---
status: pending
title: "Stateless file selector presentation and @ help entry"
type: frontend
complexity: medium
---

# Task 04: Stateless file selector presentation and @ help entry

## Overview

Create the terminal presentation leaf for repository-file completion and document the @ trigger in the existing keymap help. The component receives already-safe relative paths and status from its owner; it must not own discovery, mutable completion state, controller access, or a second navigation map.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST create a stateless `FileSelector` that renders ready rows, loading, no-match, and unavailable states above the prompt owner.
2. MUST render full repository-relative paths so duplicate basenames remain distinguishable and MUST assume all input paths were prevalidated.
3. MUST render at most eight supplied rows with a visible highlighted row and concise non-blocking status copy.
4. MUST add an `@` discovery entry to `EDITOR_KEYMAP` and MUST reuse `MENU_KEYMAP`/ `matchMenuCommand` without new navigation bindings.
5. MUST keep presentation free of controller, filesystem, telemetry, and store imports.
</requirements>

## Subtasks
- [ ] 4.1 Define the presentation props and status rendering for file completion.
- [ ] 4.2 Render safe relative rows, full-path disambiguation, and highlight state.
- [ ] 4.3 Add legible loading, empty, and unavailable feedback.
- [ ] 4.4 Document @ discovery through the central editor help table.
- [ ] 4.5 Add focused component and keymap coverage.

## Implementation Details

Follow TechSpec "System Architecture > Presentation and keymap" and the existing `SlashMenu` component’s presentation-only boundary. This task defines no discovery or keyboard dispatch behavior beyond receiving already-selected presentation state.

### Relevant Files
- `src/ui/SlashMenu.tsx` — closest stateless terminal selector and visual pattern.
- `src/ui/SlashMenu.test.tsx` — presentation test conventions.
- `src/ui/keymap.ts` — single source of truth for editor help and menu navigation.
- `src/ui/keymap.test.ts` — binding uniqueness and help coverage.
- `src/ui/theme.ts` — existing palette source for terminal status text.

### Dependent Files
- `src/ui/PromptEditor.tsx` — task_06 owns state, dispatch, and placement of `FileSelector`.
- `src/ui/fileCompletion.ts` — task_05 supplies path subsets and status values to map into props.
- `src/ui/CockpitApp.tsx` — displays central help entries through existing UI flow.

### Related ADRs
- [ADR-002: Limit V1 to Normal Repository Files and Preserve Composition on No Match](adrs/adr-002.md) — requires concise non-blocking empty/unavailable feedback.
- [ADR-004: Keep @ Completion Local to the Prompt Token](adrs/adr-004.md) — requires a presentation-only selector that reuses current menu navigation.

## Deliverables
- New `src/ui/FileSelector.tsx` and colocated `FileSelector.test.tsx`.
- Updated `src/ui/keymap.ts` and `src/ui/keymap.test.ts` with the @ help entry.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for mounted terminal selector rendering and central help visibility **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Loading state shows concise discovery feedback without an empty selector border.
  - [ ] Ready rows show complete relative paths, duplicate basename disambiguation, and one highlight.
  - [ ] Empty and unavailable states show distinct legible messages and no selectable row.
  - [ ] More than eight supplied rows renders no more than eight visible candidates.
  - [ ] `EDITOR_KEYMAP` exposes @ discovery while existing `MENU_KEYMAP` command mappings remain unchanged.
- Integration tests:
  - [ ] Mounted in an OpenTUI test renderer, each selector status remains visible above a prompt-sized container without importing a controller.
  - [ ] The existing help surface includes the @ discovery description from the central keymap.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The selector is a stateless leaf that displays only safe full relative paths and status feedback.
- @ discoverability and menu navigation remain sourced from `keymap.ts`.
