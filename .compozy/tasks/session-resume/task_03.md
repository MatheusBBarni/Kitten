---
status: pending
title: "Autosave writer wired at boot"
type: backend
complexity: medium
dependencies:
  - task_01
  - task_02
---

# Task 03: Autosave writer wired at boot

## Overview
The autosave writer turns live cockpit state into a persisted run by subscribing to the app store and writing a debounced snapshot on every relevant change.
This is what makes a run resumable and doubles as crash and close recovery; it is constructed at boot and gated by the `persistenceEnabled` flag.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST create a writer that subscribes to the `AppStore` (mirroring `recorder.watch(store)`) and derives a `PersistedRunRecord` from `AppState`.
- MUST populate per-agent `sessionId`, `status`, `messageCount` (turn count), and `lastPrompt` (the last user message text, or empty), plus `focusedAgentId`, `cwd`, `gitBranch`, a per-session `runId`, and `createdAt`/`updatedAt`.
- MUST capture the most recent hand-off bundle observed in `overlays.handoffPreview` and keep it in the record even after the overlay closes; `null` until the first hand-off.
- MUST debounce writes (~250 ms) and perform a final flush on dispose.
- MUST be constructed in `createCockpitSession` and gated by `config.persistenceEnabled`; when disabled it subscribes to nothing and writes nothing.
- MUST NOT store transcript turns; only the fields above are persisted (delegating the actual write to the run store).

## Subtasks
- [ ] 3.1 Map an `AppState` snapshot to a `PersistedRunRecord`
- [ ] 3.2 Track the last-seen `overlays.handoffPreview` bundle across commits
- [ ] 3.3 Debounce writes and flush on dispose
- [ ] 3.4 Construct the writer in `createCockpitSession`, gated by `persistenceEnabled`
- [ ] 3.5 Cover mapping, debounce, bundle capture, disabled, and flush in tests

## Implementation Details
Create `src/persistence/runWriter.ts` and wire it in `src/index.ts` (`createCockpitSession`, dispose path), next to `createTelemetryRecorder`.
Follow the store-subscription shape of `recorder.watch(store)` in `src/telemetry/recorder.ts`.
Delegate the write to the `RunStore` from task_02; see the TechSpec "Development Sequencing" step 1 and ADR-003.

### Relevant Files
- `src/index.ts` — `createCockpitSession` constructs recorders and the controller; the writer is built here and flushed on dispose
- `src/telemetry/recorder.ts` — `recorder.watch(store)` is the store-subscription pattern to mirror
- `src/store/appStore.ts` — `AppState` shape and `subscribe`; `src/store/selectors.ts` for reading turns/focus
- `src/persistence/runStore.ts` — the `save`/`flush` target (task_02)

### Dependent Files
- `test/cockpitSession.test.ts` — boot wiring is exercised here
- `src/app/controller.ts` — task_07 restores what this writer produced

### Related ADRs
- [ADR-003: Cockpit-Run Persistence](../adrs/adr-003.md) — debounced store subscription drives the write

## Deliverables
- `src/persistence/runWriter.ts` subscribing, mapping, debouncing, and flushing
- Writer construction in `createCockpitSession`, gated by `persistenceEnabled`
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test that a booted session with persistence on produces a run file **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] a state with three turns (one user message "fix the parser") maps to `messageCount: 3` and `lastPrompt: "fix the parser"` for that agent
  - [ ] five rapid store commits within the debounce window produce exactly one `save`
  - [ ] a bundle seen in `overlays.handoffPreview` is persisted and survives the overlay being closed
  - [ ] a disabled writer performs zero `save` calls across many commits
  - [ ] `dispose` triggers a final `flush`
- Integration tests:
  - [ ] booting a cockpit session with `persistenceEnabled: true` creates a run file; with `false` it creates none
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A live run is continuously persisted (debounced) and flushed on exit
- The writer is a no-op when persistence is disabled and never stores transcript turns
