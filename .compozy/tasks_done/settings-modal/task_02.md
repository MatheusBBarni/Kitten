---
status: completed
title: "Reactive preferences slice and settings overlay slot"
type: backend
complexity: medium
dependencies:
  - task_01
---

# Task 02: Reactive preferences slice and settings overlay slot

## Overview
Make configuration reactive by adding a preferences slice and a settings overlay slot to the app store, with the actions and selectors the modal needs.
This lets the settings modal open and close and lets a theme change repaint the cockpit live, reusing the store's existing structural-sharing subscription model.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `preferences: { theme: ThemePreference }` to `AppState`, seeded from an optional `AppStoreOptions.preferences` (default `{ theme: "auto" }`).
- MUST add a `settings: SettingsOverlay | null` slot to `OverlayState` with `openSettings`/`closeSettings` using the existing `setOverlays` structural-sharing patch.
- MUST add `setThemePreference(theme)` that patches only the preferences slice and is a no-op when the value is unchanged.
- MUST add selectors `selectThemePreference` and `selectSettingsOverlay`, and extend `selectHasOpenOverlay` to include the settings slot.
- MUST keep state immutable so a subscriber to an unrelated slice stays silent when only preferences or the settings slot changes.
</requirements>

## Subtasks
- [x] 2.1 Add the preferences slice and the `AppStoreOptions.preferences` seed
- [x] 2.2 Add the `settings` overlay slot and `openSettings`/`closeSettings`
- [x] 2.3 Add `setThemePreference` with an unchanged-value no-op
- [x] 2.4 Add `selectThemePreference`/`selectSettingsOverlay` and extend `selectHasOpenOverlay`
- [x] 2.5 Cover slot isolation and subscription silence in tests

## Implementation Details
Modify `src/store/appStore.ts` (`OverlayState`, `AppState`, `AppStoreOptions`, the actions, and the initializer) and `src/store/selectors.ts`.
Follow the existing `approval`/`handoffPreview` slot pattern (`openApproval`/`closeApproval` via `setOverlays`) and the `selectHasOpenOverlay` aggregate.
See the TechSpec "Core Interfaces" section for the store additions.

### Relevant Files
- `src/store/appStore.ts` — `OverlayState`, `AppState`, `AppStoreOptions`, actions, initializer
- `src/store/selectors.ts` — overlay and new preference selectors

### Dependent Files
- `src/store/appStore.test.ts`, `src/store/selectors.test.ts` — extend with the new slice/slot
- `src/ui/theme.ts` — task_03 reads `selectThemePreference`
- `src/ui/SettingsView.tsx` — task_08 drives these actions
- `src/index.ts` — task_09 seeds preferences and subscribes to changes

### Related ADRs
- [ADR-004: Reactive, persisted configuration](../adrs/adr-004.md) — the preferences slice
- [ADR-002: Instant-apply, live-preview interaction model](../adrs/adr-002.md) — the settings overlay behavior

## Deliverables
- A `preferences` slice, a `settings` overlay slot, and the `openSettings`/`closeSettings`/`setThemePreference` actions
- New selectors and an extended `selectHasOpenOverlay`
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test exercising open/change/close in sequence **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `createAppStore` seeds `preferences.theme` from options (default `"auto"`)
  - [ ] `openSettings` sets only `overlays.settings`; the approval and hand-off slots keep their identity
  - [ ] `closeSettings` on an already-closed slot is a no-op (state identity preserved)
  - [ ] `setThemePreference("dark")` patches only `preferences`; calling it again with `"dark"` returns identical state
  - [ ] `selectHasOpenOverlay` is `true` when only the settings slot is open
  - [ ] a `selectAgentTurns` subscriber is not notified when `setThemePreference` fires
- Integration tests:
  - [ ] open settings, change the theme, then close settings, asserting each action touched only its own slice
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The settings slot and preferences slice follow the store's structural-sharing pattern
- `selectHasOpenOverlay` accounts for the settings slot
