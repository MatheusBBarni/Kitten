---
status: completed
title: "Translate ACP available_commands_update in the adapter"
type: backend
complexity: medium
dependencies:
  - task_01
---

# Task 02: Translate ACP available_commands_update in the adapter

## Overview
Replace the current discard of the ACP `available_commands_update` notification with a real translation into the domain `commands` event, so the focused agent's advertised commands flow into the store.
The translation must flatten `input.hint`, drop `_meta`, and keep every ACP wire type inside `src/agent/`.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST translate `available_commands_update` into a `{ kind: "commands" }` domain event, mapping each ACP `AvailableCommand` `name`/`description`/`input.hint` into the protocol-free `AvailableCommand`, per the TechSpec "Integration Points" section and ADR-003.
- MUST drop `_meta` and every other ACP-only field so the `FORBIDDEN_ACP_KEYS` completeness test passes; no ACP type may appear in the returned event.
- MUST remove `available_commands_update` from the null-returning variant table in `acpTranslate.test.ts` and add positive-case coverage.
- MUST leave the other unsurfaced variants (thoughts, plan deltas, mode/session) returning `null`; `usage_update` remains surfaced because current repository behavior supersedes this packet's older usage no-op assumption.
</requirements>

## Subtasks
- [x] 2.1 Add a `translateCommand` helper mapping one ACP command to the domain shape.
- [x] 2.2 Replace the `available_commands_update` no-op with a real case using that helper.
- [x] 2.3 Import the ACP command type under an aliased name at the adapter boundary only.
- [x] 2.4 Remove the `available_commands_update` row from the null-variant test table.
- [x] 2.5 Add positive translation tests, a reducer round-trip test, and extend the completeness test to cover the new event.

## Implementation Details
Use the existing `config_options` translation (`translateConfigOptions` + its case) as the structural template; it already maps an advertised ACP list into a protocol-free domain event.
See the TechSpec "System Architecture > Component Overview" (ACP translation) and "Integration Points"; do not duplicate the shapes here.

### Relevant Files
- `src/agent/acpTranslate.ts` - holds the `config_options` case (template), the current `available_commands_update -> null` block, and the ACP type imports.
- `src/agent/acpTranslate.test.ts` - holds the null-variant `it.each` table, the `FORBIDDEN_ACP_KEYS` completeness test, and the `config_options` describe block (positive-case + round-trip template).
- `node_modules/@agentclientprotocol/sdk` - source of `AvailableCommandsUpdate` / `AvailableCommand` / `UnstructuredCommandInput` shapes.

### Dependent Files
- `src/core/sessionReducer.ts` - the reducer case (task_01) that consumes the emitted event.
- `src/store/selectors.ts` - task_03 reads the resulting state.

### Related ADRs
- [ADR-003: Surface agent commands as a config_options-style domain slice](../adrs/adr-003.md) - mandates dropping `_meta`, flattening `input.hint`, and no ACP leak.

## Deliverables
- A `translateCommand` helper and the `available_commands_update` translation case.
- Updated `acpTranslate.test.ts` (null-table entry removed, positive + round-trip + completeness coverage).
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test for the translate-through-reducer round-trip **(REQUIRED)**

## Tests
- Unit tests:
  - [x] An update with two commands (one with `input.hint`, one without) yields a `commands` event with both names/descriptions and `hint` set for the first and undefined for the second.
  - [x] `_meta` present on the update and on an individual command is absent from the translated event (assert via the completeness `collectKeys`/`FORBIDDEN_ACP_KEYS` walk).
  - [x] An update with an empty `availableCommands` array yields a `commands` event with an empty list (not `null`).
  - [x] The remaining unsurfaced variants (`agent_thought_chunk`, `current_mode_update`, `plan_update`, `plan_removed`, `session_info_update`) still translate to `null`; `usage_update` retains its newer domain translation.
- Integration tests:
  - [x] An `available_commands_update` fed through `translateSessionUpdate` then the reducer lands the list on `SessionState.commands`.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The completeness test passes with the new event exercised (no forbidden ACP key leaks).
- The null-variant table no longer lists `available_commands_update`.
