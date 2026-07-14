---
status: completed
title: "Upgrade Sessions overlay for overflow and background work"
type: frontend
complexity: medium
---

# Task 11: Upgrade Sessions overlay for overflow and background work

## Overview

Evolve the existing Sessions overlay into the universal overflow, background-work, and attention navigation surface for Session Tabs. It must keep all non-Closed conversations reachable at narrow sizes while preserving modal ownership and the existing handoff-picker contract.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST list every non-Closed conversation in deterministic workspace order and distinguish Visible, Background, selection, and attention without color-only signaling.
2. MUST select Visible entries and reopen/select Background entries through ControllerActions while retaining the existing runtime.
3. MUST route next-attention across Visible and Background conversations by approval, error, finished, then forward workspace order.
4. MUST keep all rows, hints, and selection reachable in narrow/long layouts without input leakage or multiple tab rows.
5. MUST preserve approval precedence, Escape focus restoration, and HandoffTargetPicker compatibility with shared card presentation.
</requirements>

## Subtasks
- [x] 11.1 Present ordered Visible and Background conversation rows with accessible lifecycle cues.
- [x] 11.2 Route selection, reopen, and attention actions through ControllerActions.
- [x] 11.3 Keep off-screen rows reachable with deterministic keyboard scrolling.
- [x] 11.4 Preserve modal precedence, Escape behavior, and non-leaking keyboard ownership.
- [x] 11.5 Protect shared SessionCard consumers from misleading lifecycle changes.

## Implementation Details

Reference the TechSpec’s **UI and Input Design**, **Attention Rules**, and **PRD Requirement Mapping** sections. Reuse the tested modal/scrollbox conventions rather than adding a second overflow surface.

### Relevant Files
- `src/ui/SessionsOverlay.tsx` — modal list, row presentation, keyboard routing, and attention interaction.
- `src/ui/SessionsOverlay.test.tsx` — existing overlay, focus, selection, and keyboard coverage.
- `src/store/selectors.ts` — ordered visible/background/attention selector view models.
- `src/ui/SessionPicker.tsx` — established scrollbox, stable row ID, and viewport behavior reference.
- `src/ui/HandoffTargetPicker.tsx` — shared SessionCard consumer requiring compatible presentation.
- `test/sessionStatus.integration.test.tsx` — rendered status, overlay, and attribution integration coverage.

### Dependent Files
- `src/ui/HandoffTargetPicker.test.tsx` — protects shared card/filter/modal behavior.
- `src/ui/SessionPicker.test.tsx` — scroll and narrow-viewport reference tests.
- `src/ui/keymap.ts` — canonical overlay command and fallback hint ownership.
- `src/ui/CockpitApp.tsx` — overlay mounting and approval precedence.
- `src/store/appStore.ts` — workspace mutations and overlay state.
- `src/app/actions.ts` — select, reopen, and attention action boundary.

### Related ADRs
- [ADR-001: Ship a Bounded, Attention-Safe Session-Tab Lifecycle](adrs/adr-001.md) — requires reachable background attention.
- [ADR-002: Prioritize a Restorable, Fast-Switching Conversation Tab Workspace](adrs/adr-002.md) — requires deterministic overflow reachability.
- [ADR-005: Gate Requested Tab Chords on Kitty Keyboard Events and Retain Sessions Fallback](adrs/adr-005.md) — names SessionsOverlay as the universal fallback.

## Deliverables
- SessionsOverlay support for visible/background lifecycle, overflow, and attention navigation.
- Narrow-layout, modal-precedence, and shared-card compatibility coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests covering off-screen/background attention routing **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Visible and Background rows render in workspace order with lifecycle, attention, duplicate-name, and non-color cues.
  - [x] Enter selects Visible rows and reopens/selects Background rows without creating a new runtime.
  - [x] Attention jump includes Background, excludes Closed, ranks states correctly, and advances deterministically.
  - [x] Arrow navigation, scrolling, footer hints, Escape, and overlay key suppression behave at narrow/long boundaries.
  - [x] Approval presence suppresses overlay action dispatch and shared SessionCard behavior remains valid for handoff candidates.
- Integration tests:
  - [x] A narrow fleet with hidden tabs reaches every Visible/Background entry through the overlay.
  - [x] An approval originating in background work remains attributed correctly after direct attention routing.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing.
- Test coverage >=80%.
- Overflow and background work remain keyboard-accessible on every terminal size.
- Attention routing never loses lifecycle or originating-conversation identity.
