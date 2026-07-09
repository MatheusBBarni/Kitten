---
status: pending
title: "Store restoration state and session-picker slot"
type: backend
complexity: medium
dependencies: []
---

# Task 06: Store restoration state and session-picker slot

## Overview
The UI needs two new pieces of shared state: whether the session picker is open, and each pane's restoration status.
This adds a `sessionPicker` overlay slot and a `restoration` map to the store, with their actions and selectors, and includes the picker in the overlay gate so the shell stands down when it is open.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a `sessionPicker` slot to `OverlayState` with `openSessionPicker()` and `closeSessionPicker()` actions and a `selectSessionPicker` selector.
- MUST include the `sessionPicker` slot in `selectHasOpenOverlay` so the shell key handler stands down when it is open.
- MUST add `restoration: Record<AgentId, RestorationMode | null>` to `AppState` (with `RestorationMode = "live" | "unavailable"`), a `setRestoration(agentId, mode)` action, and a `selectRestoration(agentId)` selector.
- MUST initialize `restoration` to `null` for every agent.
- MUST preserve the immutable commit semantics and not clobber the existing `approval` and `handoffPreview` slots.

## Subtasks
- [ ] 6.1 Add the `sessionPicker` slot, its actions, and its selector
- [ ] 6.2 Include the picker in `selectHasOpenOverlay`
- [ ] 6.3 Add the `restoration` map, its action, and its selector
- [ ] 6.4 Initialize `restoration` to `null` per agent
- [ ] 6.5 Cover open/close, the overlay gate, restoration set/read, and slot isolation in tests

## Implementation Details
Modify `src/store/appStore.ts` (`OverlayState`, `AppState`, the `AppStore` actions, `createAppStore`) and `src/store/selectors.ts` (`selectHasOpenOverlay` plus the new selectors).
Follow the existing overlay-slot pattern used by `approval` and `handoffPreview`; see the TechSpec "Core Interfaces" section and ADR-004.

### Relevant Files
- `src/store/appStore.ts` — `OverlayState`, `AppState`, actions, `commit`, `createAppStore`
- `src/store/selectors.ts` — `selectHasOpenOverlay` and the sibling overlay selectors

### Dependent Files
- `src/app/controller.ts` — task_07 calls `setRestoration`
- `src/ui/CockpitApp.tsx` — the `overlayOpen` gate reads `selectHasOpenOverlay`
- `src/ui/SessionPicker.tsx` — task_09 reads `selectSessionPicker` and calls the open/close actions
- `src/ui/ConversationView.tsx` / `StatusStrip.tsx` — task_12 reads `selectRestoration`

### Related ADRs
- [ADR-004: Live Restore via loadSession Replay](../adrs/adr-004.md) — the two-state restoration model and the picker slot

## Deliverables
- A `sessionPicker` overlay slot with actions, a selector, and inclusion in `selectHasOpenOverlay`
- A `restoration` map with `setRestoration` and `selectRestoration`
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test that opening the picker makes the shell stand down **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `openSessionPicker()` sets the slot and `selectHasOpenOverlay` returns `true`
  - [ ] `closeSessionPicker()` clears the slot and `selectHasOpenOverlay` returns `false`
  - [ ] `setRestoration("codex", "unavailable")` is reflected by `selectRestoration("codex")`
  - [ ] `restoration` defaults to `null` for both agents
  - [ ] opening the session picker leaves the `approval` and `handoffPreview` slots untouched
- Integration tests:
  - [ ] with the picker open, `selectHasOpenOverlay` is `true` so the shell key handler stands down
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The picker slot and restoration map are readable and writable through the store
- The overlay gate accounts for the picker; existing slots are unaffected
