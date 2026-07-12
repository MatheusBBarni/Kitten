---
status: completed
title: "ACP translation of config-option updates"
type: backend
complexity: low
dependencies:
  - task_01
---

# Task 02: ACP translation of config-option updates

## Overview
Translate the ACP `config_option_update` notification, currently dropped, into the domain `config_options` event so agent-advertised model and effort changes reach the store.
This keeps ACP wire types inside the adapter layer and preserves the anti-corruption boundary.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST translate the ACP `config_option_update` notification into a `{ kind: "config_options"; options: ConfigOption[] }` domain event in `translateSessionUpdate`.
- MUST map each ACP select config option to the domain `ConfigOption` shape (id, category, label, currentValue, options), keeping `category` opaque.
- MUST continue returning `null` for `current_mode_update` and the other currently-dropped update variants.
- MUST NOT translate boolean config options in V1 (select options only); a boolean option MUST be skipped, not crash.
- MUST keep all ACP SDK imports confined to `src/agent`.

</requirements>

## Subtasks
- [x] 2.1 Add a `config_option_update` case to `translateSessionUpdate`
- [x] 2.2 Map ACP `SessionConfigOption` select entries to the domain `ConfigOption` shape
- [x] 2.3 Skip boolean options and preserve the existing dropped-variant behavior
- [x] 2.4 Cover the new case and the still-dropped variants with fixtures

## Implementation Details
Modify the pure translator. See TechSpec "System Architecture" (Agent Adapter Layer) and "Integration Points". The change is at the `config_option_update` branch currently returning `null`.

### Relevant Files
- `src/agent/acpTranslate.ts` — the `translateSessionUpdate` switch; `config_option_update` currently returns `null` at line 55
- `src/agent/acpTranslate.test.ts` — per-variant translation unit tests

### Dependent Files
- `src/agent/agentConnection.ts` (task_03) — routes `onSessionUpdate` through this translator (lines 233-242)
- `src/core/types.ts` (task_01) — provides `ConfigOption` and the `config_options` event

### Related ADRs
- [ADR-004: Live in-place switching with confirmed-state UI and a category allowlist](adrs/adr-004.md) — `config_option_update` carries agent-confirmed state; `current_mode_update` stays dropped
- [ADR-003: Generic config-option channel in the domain core](adrs/adr-003.md) — the target domain shape

## Deliverables
- A `config_option_update` translation branch producing `config_options`
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration coverage that a translated event flows through unchanged **(REQUIRED)**

## Tests
- Unit tests:
  - [x] A `config_option_update` carrying a `model` select option translates to a `config_options` event with the mapped `ConfigOption`
  - [x] A `config_option_update` carrying both `model` and `thought_level` options maps both, preserving `currentValue` and the option list
  - [x] A boolean config option in the update is skipped and does not appear in the domain event
  - [x] `current_mode_update` still returns `null`
  - [x] `usage_update` and `plan_update` still return `null`
- Integration tests:
  - [x] A scripted `config_option_update` fed through the translator and reducer (task_01) results in `SessionState.configOptions` matching the update
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `config_option_update` produces a `config_options` domain event; other dropped variants unchanged
- No ACP SDK types leak outside `src/agent`
