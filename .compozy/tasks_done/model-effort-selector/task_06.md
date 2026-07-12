---
status: completed
title: "ModelSelect overlay, keymap, and mid-switch warning"
type: frontend
complexity: high
dependencies:
  - task_04
  - task_05
---

# Task 06: ModelSelect overlay, keymap, and mid-switch warning

## Overview
Build the user-facing selector: a single combined overlay that lists model and effort for the focused pane, applies changes through the controller action, and renders only agent-confirmed state.
Applying a change inside an established conversation swaps the overlay into an inline confirm step warning that switching may reduce quality; a new keybinding opens it and it appears in the help panel.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST render a single overlay showing model and effort sections from `visibleConfigOptions`, with current values marked, mirroring the `HandoffPreview`/`ApprovalPrompt` modal pattern (keyboard capture, `preventDefault`, Enter/Esc).
- MUST hide the effort section when the current model has no effort options, and refresh effort from the returned set after a model change.
- MUST render only agent-confirmed state and show an `unverified` indication when a switch is not confirmed; MUST NOT display the optimistically requested value.
- MUST show an inline confirm step warning that the session was optimized for the current model/effort and switching may reduce quality, only when applying inside an established conversation (turns present); MUST skip it on a fresh session.
- MUST add a `model-select` command and binding to the keymap and dispatch it in `CockpitApp`, guarded by `selectHasOpenOverlay`; the chord MUST NOT be `Ctrl+M` (equals carriage return); confirm no collision with `Ctrl+O`/`Ctrl+T`.
- MUST operate on the focused pane and appear in the help panel.
</requirements>

## Subtasks
- [x] 6.1 Build the `ModelSelect` overlay reading the open slot and `selectAgentConfigOptions`
- [x] 6.2 Render model and effort sections with confirmed values; hide effort when unsupported
- [x] 6.3 Add the inline confirm step gated on an established conversation
- [x] 6.4 Apply changes via `actions.setSessionConfigOption` and reflect confirmed/unverified state
- [x] 6.5 Add the `model-select` keymap command, binding, and overlay keymap; choose a safe chord
- [x] 6.6 Dispatch and mount the overlay in `CockpitApp`

## Implementation Details
Create the overlay and wire the keymap. See TechSpec "System Architecture" (UI Shell), "Technical Considerations", ADR-004. Mirror `HandoffPreview.tsx` (multi-section overlay, two-mode key handling) and the keymap additions in `keymap.ts` (`COCKPIT_KEYMAP` 79-107, matchers 263-276); dispatch in `CockpitApp.tsx` (77-110) and mount at 153-158.

### Relevant Files
- `src/ui/ModelSelect.tsx` — new; the overlay component and inline confirm step
- `src/ui/keymap.ts` — new `model-select` command (union at 36), binding (79-107), `MODEL_KEYMAP`/matcher, hint string
- `src/ui/CockpitApp.tsx` — dispatch case (84-107), overlay mount (153-158), gate via `selectHasOpenOverlay` (71,82)
- `src/ui/ModelSelect.test.tsx`, `src/ui/keymap.test.ts` — rendered and predicate tests

### Dependent Files
- `src/ui/HandoffPreview.tsx` (task_08) — reuses the model/effort control built here
- `src/store/selectors.ts` (task_04) — provides the slot, config selectors, and allowlist

### Related ADRs
- [ADR-004: Live in-place switching with confirmed-state UI and a category allowlist](adrs/adr-004.md) — confirmed-state rendering, allowlist
- [ADR-002: V1 rollout as a compose-complete MVP](adrs/adr-002.md) — the selector ships with the MVP

## Deliverables
- The `ModelSelect` overlay with the inline mid-switch warning
- The `model-select` keymap command, binding, and help entry
- Unit tests with 80%+ coverage **(REQUIRED)**
- Rendered integration tests through `CockpitApp` **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `matchCommand` maps the chosen chord to `model-select`; `Ctrl+M` is not the binding
  - [x] The overlay hides the effort section when the current model exposes no effort options
  - [x] After a model change, the effort section renders from the refreshed option set
  - [x] The overlay shows `unverified` when the applied value is not confirmed and never shows a requested-but-unconfirmed value
- Integration tests:
  - [x] Pressing the chord opens the overlay for the focused pane; the current model/effort are marked
  - [x] Applying a change on a session with prior turns shows the confirm step; Enter proceeds and calls `setSessionConfigOption`, Esc returns without applying
  - [x] Applying a change on a fresh session (no turns) applies without a confirm step
  - [x] Esc from the selector closes it and changes nothing
- Test coverage target: >=80% (achieved: `ModelSelect.tsx` 95% funcs / 98% lines, `keymap.ts` 100%)
- All tests must pass (652 pass / 0 fail)

## Success Criteria
- All tests passing
- Test coverage >=80%
- The selector opens via a safe chord, shows confirmed state, and gates the warning on an established conversation
- The overlay follows the existing modal pattern and stands down for approval overlays
