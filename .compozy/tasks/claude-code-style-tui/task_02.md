---
status: completed
title: "First-run state module and welcomeBanner config field"
type: backend
complexity: medium
dependencies: []
---

# Task 02: First-run state module and welcomeBanner config field

## Overview
Introduce Kitten's first app-written runtime state - a fail-soft first-run marker - plus a read-only `welcomeBanner` config preference, so the banner can show in full on the first launch and auto-quiet afterward.
This keeps `config.json` strictly user-authored while the marker lives in the XDG state directory, mirroring the telemetry recorder's state handling.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `src/config/appState.ts` exposing `readFirstRunSeen()`, `markFirstRunSeen()`, and `bannerVariant(pref, seen)` per the TechSpec "Core Interfaces" section.
- MUST resolve `$XDG_STATE_HOME/kitten/state.json` (falling back to `~/.local/state/kitten/state.json`), with an injectable `env` seam, mirroring `resolveTelemetryPath`.
- MUST make all reads and writes fail-soft: never throw, never block boot; a missing or unparseable state file reads as "not seen".
- MUST validate the state file with a small zod schema and reset on parse failure.
- MUST add an optional `welcomeBanner: "auto" | "always" | "off"` field to the config schema, the `AppConfig` type, the defaults, and the merge, defaulting to `"auto"`.
- MUST keep `configLoader` read-only — no code writes `config.json`.
</requirements>

## Subtasks
- [x] 2.1 Create `appState.ts` with the XDG state-path resolver and fail-soft read/write.
- [x] 2.2 Add the zod state schema and reset-on-parse-failure behavior.
- [x] 2.3 Implement `bannerVariant` for the `auto`/`always`/`off` x seen truth table.
- [x] 2.4 Add the `welcomeBanner` field across the config schema, type, defaults, and merge.
- [x] 2.5 Add unit tests for the state module and the config field.

## Implementation Details
Create `src/config/appState.ts` and `src/config/appState.test.ts`.
Modify `src/config/configLoader.ts` (`USER_CONFIG_SCHEMA`, `defaultAppConfig`, `mergeAppConfig`) and `src/core/types.ts` (`AppConfig`).
Mirror `resolveTelemetryPath` in `src/telemetry/recorder.ts` for the XDG state path and its env override, and use the injectable-`env` seam convention. See ADR-005 and the TechSpec "Data Models" section.

### Relevant Files
- `src/config/configLoader.ts` — schema/defaults/merge patterns; add `welcomeBanner` in the four documented spots.
- `src/telemetry/recorder.ts` — `resolveTelemetryPath` XDG-state pattern to mirror.
- `src/core/types.ts` — `AppConfig` interface.
- `src/config/configLoader.test.ts` — config-test style (temp dirs, injectable seams).

### Dependent Files
- `src/index.ts` (task_05) — reads `welcomeBanner` + `bannerVariant` + `markFirstRunSeen` at boot.
- `src/ui/ConversationView.tsx` / `src/ui/CockpitApp.tsx` (task_06) — read the variant for the idle screen.

### Related ADRs
- [ADR-005: First-Run Persistence via a Runtime State File plus a Read-Only Config Setting](adrs/adr-005.md) — This task's core decision.

## Deliverables
- `src/config/appState.ts` with fail-soft `readFirstRunSeen`/`markFirstRunSeen`/`bannerVariant`.
- `welcomeBanner` config field wired through schema, type, defaults, and merge.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test: config load returns the default and merged `welcomeBanner` value **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `readFirstRunSeen()` returns false when the state file is absent, true after `markFirstRunSeen()`.
  - [x] A malformed `state.json` resets to "not seen" without throwing.
  - [x] An injected failing writer makes `markFirstRunSeen()` return without throwing.
  - [x] `bannerVariant("auto", false)` = "full"; `("auto", true)` = "quiet"; `("always", *)` = "full"; `("off", *)` = "none".
  - [x] The XDG path resolves to `$XDG_STATE_HOME/kitten/state.json` and honors the env override.
- Integration tests:
  - [x] `loadAppConfig` defaults `welcomeBanner` to `"auto"`; a user config `{ "welcomeBanner": "off" }` merges to `"off"`; an unknown enum value is rejected by the strict schema.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `config.json` remains read-only (no write path added to `configLoader`)
- State read/write never throws and never blocks boot
