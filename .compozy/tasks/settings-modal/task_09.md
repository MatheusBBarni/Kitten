---
status: completed
title: "Persistence and watcher wiring at boot"
type: backend
complexity: medium
dependencies:
  - task_02
  - task_04
  - task_05
  - task_07
---

# Task 09: Persistence and watcher wiring at boot

## Overview
Wire the reactive config loop in `createCockpitSession`: seed the store preferences from config, persist preference changes to disk (debounced), reconcile external edits through the watcher, and emit the theme and write telemetry.
This closes the loop so a modal change is durable and a hand-edit reconciles into the running app without a write-reload cycle.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST seed the store's preferences from the loaded `AppConfig.theme` at store creation.
- MUST subscribe to `selectThemePreference` and persist changes with a debounced `persistUserConfig({ theme })`, emitting `theme_set` on change and `config_write`/`config_write_error` on the write outcome.
- MUST start `watchUserConfig` and apply external changes via `setThemePreference`, relying on the unchanged-value no-op to break the write-reload loop.
- MUST NOT write to disk from any view; all persistence lives in this app-layer wiring (ADR-003 layering).
- MUST close the watcher and cancel any pending debounced write on dispose.
</requirements>

## Subtasks
- [x] 9.1 Seed `createAppStore` preferences from `config.theme`
- [x] 9.2 Subscribe to the preference selector and debounce-persist via `persistUserConfig`
- [x] 9.3 Emit `theme_set` on change and `config_write`/`config_write_error` on write outcome
- [x] 9.4 Start `watchUserConfig` and feed external changes to `setThemePreference`
- [x] 9.5 Close the watcher and cancel pending writes on dispose
- [x] 9.6 Cover seeding, debounced persist, write-outcome telemetry, and reload-loop safety in tests

## Implementation Details
Modify `src/index.ts` `createCockpitSession` (and the dispose/teardown seam it feeds).
Compose `createAppStore({ preferences })`, the preference-change persistence subscriber, and `watchUserConfig`, reusing the injectable-deps style already used for `loadConfig`/`createRecorder`.
See the TechSpec "System Architecture" (app-layer wiring) and "Development Sequencing" step 9, and ADR-004.

### Relevant Files
- `src/index.ts` — `createCockpitSession`, its deps interface, and teardown wiring

### Dependent Files
- `src/config/configWriter.ts` (task_04), `src/config/configWatcher.ts` (task_05) — invoked here
- `src/store/appStore.ts` (task_02) — seeded and subscribed
- `src/telemetry/recorder.ts` (task_07) — emits `theme_set`/`config_write*`
- `src/index.test.ts` (or the cockpit-session test) — extend

### Related ADRs
- [ADR-004: Reactive, persisted configuration](../adrs/adr-004.md) — the persist + watcher loop
- [ADR-002: Instant-apply, live-preview interaction model](../adrs/adr-002.md) — instant apply, deferred debounced write

## Deliverables
- Boot wiring that seeds preferences, debounce-persists changes, and reconciles external edits
- Write-outcome and theme telemetry emission, with watcher teardown on dispose
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test round-tripping a theme change to disk without a reload loop **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `createCockpitSession` seeds the store preference from `config.theme` (inject `loadConfig`)
  - [x] changing the store preference triggers one debounced `persistUserConfig` with that theme (inject a fake writer)
  - [x] a successful write emits `config_write`; a writer that throws emits `config_write_error` and does not crash
  - [x] an external watcher callback with a new theme updates the store preference
  - [x] a watcher callback equal to the current preference performs no re-persist (loop broken)
  - [x] dispose closes the watcher and cancels a pending debounced write
- Integration tests:
  - [x] boot against a temp config, change the theme via the store, assert the file updates and a following watcher event does not loop
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Modal changes persist durably; external edits reconcile live without a loop
- No view writes to disk; the watcher is torn down on dispose
