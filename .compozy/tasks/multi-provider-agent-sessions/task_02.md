---
status: pending
title: "Fleet configuration model"
type: backend
complexity: high
dependencies:
  - task_01
---

# Task 02: Fleet configuration model

## Overview
Rework configuration from a fixed two-key `agents` object into a `providers` map of spawn recipes plus a `sessions` list, where each session declares its own working directory and an optional first task.
This lets a developer pre-declare a fleet across several repositories, including two sessions of the same provider, while a zero-config run still reproduces today's two-agent, single-directory behavior.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST define configuration as `providers: Record<ProviderKind, ProviderRecipe>` plus `sessions: SessionDescriptor[]` plus `telemetryEnabled`, per the TechSpec "Data Models" section and ADR-005.
- MUST validate with zod and reject unknown keys, keeping the pinned adapter versions as the provider defaults.
- MUST resolve each `SessionDescriptor` into the per-session spawn-plus-`cwd` input the controller consumes; `title` defaults to the `cwd` basename and `task` is optional.
- MUST seed one session per configured provider in the launch directory when the file declares no `sessions`, preserving today's behavior.
- SHOULD accept the legacy `agents` object as an alias for `providers` for one deprecation window, or document the one-line migration.
</requirements>

## Subtasks
- [ ] 2.1 Define the `providers` + `sessions` schema and the `SessionDescriptor`/`ProviderRecipe` types.
- [ ] 2.2 Rewrite the defaults and the per-field merge over the pinned provider recipes.
- [ ] 2.3 Resolve session descriptors into per-session spawn-plus-`cwd` inputs, defaulting `title` to the directory basename.
- [ ] 2.4 Implement the zero-config default of one session per provider in the launch directory.
- [ ] 2.5 Produce clear validation errors for unknown keys and for a missing or unreadable `cwd`.

## Implementation Details
Extend `AppConfig` in the core and rewrite the loader per the TechSpec "Data Models" section and ADR-005.
Keep the pinned adapter packages as the default `providers` recipes.
The loader's output is the ordered list of resolved sessions the controller (task_03) will spawn; validation stays in one zod schema.

### Relevant Files
- `src/config/configLoader.ts` - the schema, defaults, merge, and resolution logic to rewrite.
- `src/core/types.ts` - `AppConfig`, plus new `SessionDescriptor` and `ProviderRecipe` types.

### Dependent Files
- `src/app/controller.ts` - consumes the resolved per-session inputs (task_03).
- `src/index.ts` - calls `loadAppConfig` at boot.
- `src/config/firstRun.ts` - readiness now runs per resolved session.

### Related ADRs
- [ADR-005: Fleet Configuration Model - Providers Plus a Sessions List](../adrs/adr-005.md) - defines the providers/sessions split, per-session `cwd`, and the zero-config default.

## Deliverables
- A `providers` + `sessions` config schema with per-session `cwd`/`title`/`task`.
- A resolver producing the ordered per-session spawn inputs for the controller.
- The zero-config default reproducing today's two-session behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests loading a real config file **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Zero-config (no file) resolves to one session per configured provider, each with the launch directory as `cwd`.
  - [ ] A `sessions` list with two entries of the same provider but different `cwd` resolves to two descriptors with distinct working directories and distinct titles.
  - [ ] An unknown key in the config file is rejected with a `ConfigError` naming the offending field.
  - [ ] A session descriptor without a `title` defaults its title to the `cwd` basename.
  - [ ] A provider `env` override is shallow-merged over the default recipe rather than replacing it.
- Integration tests:
  - [ ] `loadAppConfig` against a temp config file that declares three sessions produces three resolved sessions in declared order with their own directories.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Zero-config behavior is identical to today
- The resolver output is consumable by the controller without further transformation
