---
status: completed
title: "Shell configuration block"
type: backend
complexity: low
dependencies:
    - task_01
    - task_03
---

# Task 06: Shell configuration block

## Overview
Let users configure the shell without touching code.
Add an optional `shell` block to the config file (enable flag, command override, scrollback size), validated with the existing zod schema and merged over defaults, then feed those settings into the `ShellRuntime` spawn.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add an optional `shell` block to `USER_CONFIG_SCHEMA` and `AppConfig` with fields for enable flag, command override, and scrollback size, following the strict-schema convention.
- MUST provide defaults in `defaultAppConfig()` (shell enabled, command from `$SHELL`, a sensible scrollback bound).
- MUST merge the block per-field over defaults in `mergeAppConfig`, leaving unspecified fields at their defaults.
- MUST surface the resolved settings to the `ShellRuntime` spawn options.
- MUST reject unknown keys in the shell block, matching the existing `.strict()` behavior.
- SHOULD keep telemetry and agent config behavior unchanged.

## Subtasks
- [ ] 6.1 Extend `USER_CONFIG_SCHEMA` and `AppConfig` with the shell block
- [ ] 6.2 Add shell defaults to `defaultAppConfig`
- [ ] 6.3 Merge the block per-field in `mergeAppConfig`
- [ ] 6.4 Thread the resolved settings into the runtime spawn options

## Implementation Details
Modify `src/config/configLoader.ts` and `src/core/types.ts` (`AppConfig`). Follow the existing per-field merge and `.strict()` schema patterns. See TechSpec "Impact Analysis" for the config surface. The runtime consumes these via task_03's spawn options.

### Relevant Files
- `src/config/configLoader.ts` — zod schema, defaults, and merge logic to extend
- `src/core/types.ts` — `AppConfig` shape
- `src/config/configLoader.test.ts` — config test conventions

### Dependent Files
- `src/shell/shellRuntime.ts` — receives the resolved spawn options (task_03)
- `src/app/controller.ts` — passes config through to the runtime (task_05)

### Related ADRs
- [ADR-004: Trustworthy Shell State via OSC 133 + OSC 7 Shell Integration](adrs/adr-004.md) — the shell command choice affects integration snippet selection

## Deliverables
- Optional `shell` config block with validation, defaults, and merge
- Resolved settings passed to the runtime
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for config merge **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] a config with no `shell` block yields the shell defaults
  - [ ] a `shell.command` override replaces the default and leaves scrollback at its default
  - [ ] an out-of-range or non-numeric scrollback value is rejected with a `ConfigError`
  - [ ] an unknown key inside `shell` is rejected by the strict schema
- Integration tests:
  - [ ] loading a file with a partial shell block produces a fully-populated `AppConfig`
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Shell settings are configurable, validated, and merged per-field
- Existing config behavior for agents and telemetry is unchanged
