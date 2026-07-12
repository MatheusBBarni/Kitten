---
status: completed
title: "Config schema and theme preference type"
type: backend
complexity: medium
dependencies: []
---

# Task 01: Config schema and theme preference type

## Overview
Introduce the user theme preference into the configuration layer so every later task has a persisted, validated value to read and write.
This adds a `ThemePreference` type and an `AppConfig.theme` field threaded through the defaults, the strict zod schema, and the delta merge, keeping the config file delta-over-defaults.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `ThemePreference = "auto" | "light" | "dark" | ThemePresetId` and `ThemePresetId = "catppuccin-mocha" | "catppuccin-latte"` to the domain core types.
- MUST add `theme: ThemePreference` to `AppConfig` and default it to `"auto"` in `defaultAppConfig`.
- MUST extend `USER_CONFIG_SCHEMA` with an optional `theme` validated against the allowed values while keeping the schema `.strict()`.
- MUST carry `theme` through `mergeAppConfig` so a user delta overrides the default and its absence yields `"auto"`.
- MUST reject an invalid `theme` value with a `ConfigError` naming the offending field, matching existing failure behavior.
</requirements>

## Subtasks
- [x] 1.1 Define `ThemePreference` and `ThemePresetId` in the core types
- [x] 1.2 Add `theme` to `AppConfig` and default it to `"auto"` in `defaultAppConfig`
- [x] 1.3 Extend the strict user config schema with an optional, validated `theme`
- [x] 1.4 Thread `theme` through `mergeAppConfig`
- [x] 1.5 Cover valid, absent, and invalid `theme` values in the loader tests

## Implementation Details
Modify `src/core/types.ts` (the `AppConfig` shape) and `src/config/configLoader.ts` (`USER_CONFIG_SCHEMA`, `mergeAppConfig`, `defaultAppConfig`).
See the TechSpec "Data Models" and "Core Interfaces" sections for the exact type, and ADR-004/ADR-005 for why the theme is a config-level delta.
Keep the schema strict and delta-over-defaults per the loader's existing design.

### Relevant Files
- `src/core/types.ts` — `AppConfig` lives here; add the preference types
- `src/config/configLoader.ts` — `USER_CONFIG_SCHEMA`, `mergeAppConfig`, `defaultAppConfig`, `ConfigError`

### Dependent Files
- `src/config/configLoader.test.ts` — extend with theme cases
- `src/store/appStore.ts` — task_02 seeds preferences from `AppConfig.theme`
- `src/ui/theme.ts` — task_03 consumes `ThemePreference`

### Related ADRs
- [ADR-004: Reactive, persisted configuration](../adrs/adr-004.md) — theme is a persisted config delta
- [ADR-005: Theme override via a palette registry](../adrs/adr-005.md) — defines `ThemePreference`

## Deliverables
- `ThemePreference` and `ThemePresetId` exported from the core types
- `AppConfig.theme` defaulting to `"auto"`, validated and merged, schema kept strict
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test loading a config file carrying a theme delta **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `defaultAppConfig()` returns `theme: "auto"`
  - [x] `parseAppConfig('{"theme":"catppuccin-mocha"}')` yields `theme: "catppuccin-mocha"`
  - [x] `parseAppConfig('{"theme":"neon"}')` throws `ConfigError` naming `theme`
  - [x] a config object omitting `theme` merges to `"auto"`
  - [x] an unknown top-level key is still rejected (strict schema preserved)
- Integration tests:
  - [x] `loadAppConfig` against a temp file containing a `theme` delta returns the merged config with that theme
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `theme` is validated, defaults to `"auto"`, and merges as a delta
- The user config schema remains strict and delta-over-defaults
