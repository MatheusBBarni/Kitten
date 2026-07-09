---
status: pending
title: "persistenceEnabled config flag"
type: backend
complexity: low
dependencies: []
---

# Task 01: persistenceEnabled config flag

## Overview
Session persistence is on by default, so the configuration layer needs a `persistenceEnabled` flag that every later task can read and that gives users an off-switch.
This adds the flag to `AppConfig`, defaulting to `true`, threaded through the defaults, the strict zod schema, and the delta merge, exactly like the existing `telemetryEnabled` flag.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a `persistenceEnabled: boolean` field to `AppConfig` and default it to `true` in `defaultAppConfig`.
- MUST introduce a `DEFAULT_SESSION_PERSISTENCE_ENABLED = true` constant mirroring `DEFAULT_TELEMETRY_ENABLED`.
- MUST extend `USER_CONFIG_SCHEMA` with an optional boolean `persistenceEnabled`, keeping the schema `.strict()`.
- MUST carry `persistenceEnabled` through `mergeAppConfig` so a user delta overrides the default and its absence yields `true`.
- MUST reject a non-boolean `persistenceEnabled` with a `ConfigError` naming the offending field, matching existing failure behavior.
</requirements>

## Subtasks
- [ ] 1.1 Add `persistenceEnabled` to the `AppConfig` type
- [ ] 1.2 Add the default constant and default it to `true` in `defaultAppConfig`
- [ ] 1.3 Extend the strict user config schema with an optional, validated `persistenceEnabled`
- [ ] 1.4 Thread `persistenceEnabled` through `mergeAppConfig`
- [ ] 1.5 Cover default, present-true, present-false, absent, and invalid-type cases in the loader tests

## Implementation Details
Modify `src/core/types.ts` (the `AppConfig` shape) and `src/config/configLoader.ts` (`DEFAULT_*` constant, `defaultAppConfig`, `USER_CONFIG_SCHEMA`, `mergeAppConfig`).
Follow the exact shape of the existing `telemetryEnabled` flag; see the TechSpec "Data Models" section and ADR-003.
Keep the schema strict and delta-over-defaults per the loader's existing design.

### Relevant Files
- `src/core/types.ts` — `AppConfig` is defined here; add the field
- `src/config/configLoader.ts` — `DEFAULT_TELEMETRY_ENABLED`, `defaultAppConfig`, `USER_CONFIG_SCHEMA`, `mergeAppConfig`, `ConfigError`

### Dependent Files
- `src/config/configLoader.test.ts` — extend with persistence cases
- `src/index.ts` — task_03 constructs the autosave writer from `config.persistenceEnabled`
- `src/config/firstRun.ts` — task_11 gates the disclosure line on this flag

### Related ADRs
- [ADR-003: Cockpit-Run Persistence](../adrs/adr-003.md) — persistence is gated by an on-by-default config flag
- [ADR-002: V1 Rollout Shape](../adrs/adr-002.md) — on-by-default persistence with an off-switch

## Deliverables
- `AppConfig.persistenceEnabled` defaulting to `true`, validated and merged, schema kept strict
- A `DEFAULT_SESSION_PERSISTENCE_ENABLED` constant
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test loading a config file carrying a `persistenceEnabled` delta **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `defaultAppConfig()` returns `persistenceEnabled: true`
  - [ ] `parseAppConfig('{"persistenceEnabled":false}')` yields `persistenceEnabled: false`
  - [ ] a config object omitting `persistenceEnabled` merges to `true`
  - [ ] `parseAppConfig('{"persistenceEnabled":"yes"}')` throws `ConfigError` naming `persistenceEnabled`
  - [ ] an unknown top-level key is still rejected (strict schema preserved)
- Integration tests:
  - [ ] `loadAppConfig` against a temp file with `persistenceEnabled: false` returns the merged config with the flag off
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `persistenceEnabled` defaults to `true`, validates, and merges as a delta
- The user config schema remains strict and delta-over-defaults
