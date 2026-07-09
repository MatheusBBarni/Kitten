---
status: pending
title: "Store slot, selectors, and category allowlist"
type: backend
complexity: medium
dependencies:
  - task_01
---

# Task 04: Store slot, selectors, and category allowlist

## Overview
Add the store surface the selector overlay and status strip subscribe to: a `modelSelect` overlay slot, curried per-agent selectors for the config channel, and the fail-closed category allowlist that hides everything except model and effort.
This is the reactive boundary between the domain `configOptions` and the UI.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a `modelSelect` overlay slot to `OverlayState` with `openModelSelect`/`closeModelSelect` actions mirroring the approval and hand-off slots.
- MUST OR the new slot into `selectHasOpenOverlay` so the shell and hand-off stand down when the selector is open.
- MUST add curried selectors `selectAgentConfigOptions`, `selectAgentModel`, and `selectAgentEffort` mirroring `selectAgentStatus`.
- MUST implement `visibleConfigOptions(options)` returning only categories in `VISIBLE_CATEGORIES = ["model", "thought_level"]`, filtering out `mode`, `model_config`, and any other category (fail-closed allowlist, per ADR-004).
- MUST keep selectors referentially stable so React subscriptions do not thrash.
</requirements>

## Subtasks
- [ ] 4.1 Add the `modelSelect` slot, its open/close actions, and init it to `null`
- [ ] 4.2 OR the slot into `selectHasOpenOverlay`
- [ ] 4.3 Add the curried config selectors for options, current model, and current effort
- [ ] 4.4 Implement `visibleConfigOptions` with the `VISIBLE_CATEGORIES` allowlist
- [ ] 4.5 Cover the slot, selectors, and allowlist with unit tests

## Implementation Details
Modify the store and selectors. See TechSpec "System Architecture" (Reactive Store) and ADR-004. Mirror the approval slot in `appStore.ts` (lines 52-55, 176-197) and `selectAgentStatus` in `selectors.ts` (lines 39-42); OR into `selectHasOpenOverlay` (lines 81-82).

### Relevant Files
- `src/store/appStore.ts` — `OverlayState` (52-55), constructor init (129), open/close + `setOverlays` (176-197)
- `src/store/selectors.ts` — curried selectors (24-66), `selectHasOpenOverlay` (81-82)
- `src/store/appStore.test.ts`, `src/store/selectors.test.ts` — store/selector unit tests
- `src/core/types.ts` (task_01) — the `ConfigOption` shape the selectors return

### Dependent Files
- `src/ui/ModelSelect.tsx` (task_06) — reads `selectAgentConfigOptions` and the open slot
- `src/ui/StatusStrip.tsx` (task_07) — reads `selectAgentModel`/`selectAgentEffort`
- `src/ui/CockpitApp.tsx` (task_06) — reads `selectHasOpenOverlay` to gate chords

### Related ADRs
- [ADR-004: Live in-place switching with confirmed-state UI and a category allowlist](adrs/adr-004.md) — the fail-closed allowlist lives here
- [ADR-003: Generic config-option channel in the domain core](adrs/adr-003.md) — the channel the selectors read

## Deliverables
- The `modelSelect` overlay slot with open/close actions
- Curried config selectors and `visibleConfigOptions`
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test that an applied `config_options` event is observable through the selectors **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `openModelSelect({ agentId })` sets the slot; `closeModelSelect` clears it; `selectHasOpenOverlay` is true while open
  - [ ] `selectAgentModel` returns the `currentValue` of the `model` category option, or undefined when absent
  - [ ] `selectAgentEffort` returns the `currentValue` of the `thought_level` category option, or undefined when absent
  - [ ] `visibleConfigOptions` returns model and effort options and drops a `mode` (`bypassPermissions`) option
  - [ ] `visibleConfigOptions` drops an unknown/future category not in the allowlist
- Integration tests:
  - [ ] Dispatching a `config_options` event (task_01) makes `selectAgentModel` observe the new value through `subscribeSelector`
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The store exposes the selector slot and config selectors; the allowlist never surfaces `mode`
- Selectors are referentially stable across renders
