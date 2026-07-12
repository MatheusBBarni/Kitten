---
status: completed
title: "Domain config-option channel and reducer"
type: backend
complexity: medium
dependencies: []
---

# Task 01: Domain config-option channel and reducer

## Overview
Add the Kitten-owned, protocol-free config-option channel to the domain core and the reducer case that applies it.
This is the foundation every other task reads: a generic list of agent-advertised options on `SessionState`, plus a `config_options` domain event the reducer applies as a wholesale replace.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST define the `ConfigOption` and `ConfigSelectOption` domain types from the TechSpec "Core Interfaces" and "Data Models" sections, keeping `category` an opaque string.
- MUST add `configOptions: ConfigOption[]` to `SessionState` and default it to `[]` in `createSessionState`.
- MUST add a `{ kind: "config_options"; options: ConfigOption[] }` member to the `DomainSessionEvent` union.
- MUST implement the reducer case as a wholesale replace of `state.configOptions`, keeping the `assertNever` exhaustiveness guard compiling.
- MUST NOT import the ACP SDK anywhere in `src/core` (translation is owned by the adapter layer, per ADR-003).
</requirements>

## Subtasks
- [x] 1.1 Define `ConfigOption`/`ConfigSelectOption` in the domain types module
- [x] 1.2 Extend `SessionState` with `configOptions` and default it in `createSessionState`
- [x] 1.3 Add the `config_options` member to the `DomainSessionEvent` union
- [x] 1.4 Implement the reducer case as an immutable wholesale replace
- [x] 1.5 Cover creation default, replace semantics, and exhaustiveness with fixtures

## Implementation Details
Extend the pure core. See TechSpec "Core Interfaces" and "Data Models" for the exact type shapes; reference them rather than reproducing here. The reducer remains the single writer of `SessionState`, deterministic and side-effect free.

### Relevant Files
- `src/core/types.ts` — add `ConfigOption`/`ConfigSelectOption`, extend `SessionState` (lines 118-129), extend `DomainSessionEvent` (lines 135-140)
- `src/core/sessionReducer.ts` — default in `createSessionState` (lines 26-36), new case in `sessionReducer` (lines 39-64)
- `src/core/sessionReducer.test.ts` — fixture-driven unit tests for the new case

### Dependent Files
- `src/agent/acpTranslate.ts` (task_02) — will emit the `config_options` event this reducer consumes
- `src/store/selectors.ts` (task_04) — will read `SessionState.configOptions`
- `src/agent/agentConnection.ts` (task_03) — will seed options through this event

### Related ADRs
- [ADR-003: Generic config-option channel in the domain core](adrs/adr-003.md) — defines the opaque-category channel this task implements
- [ADR-001: V1 scope](adrs/adr-001.md) — generic data, narrow render

## Deliverables
- `ConfigOption`/`ConfigSelectOption` types and `SessionState.configOptions`
- The `config_options` domain event and its reducer case
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test folding a multi-event sequence that includes `config_options` **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `createSessionState` returns `configOptions: []`
  - [x] A `config_options` event with two options replaces an empty `configOptions` with exactly those two
  - [x] A second `config_options` event fully replaces the prior set (no merge, no duplicates)
  - [x] Applying `config_options` leaves `turns`, `status`, and `pendingDiffs` unchanged
  - [x] The reducer returns a new object (input state not mutated)
- Integration tests:
  - [x] Folding `user_message` → `config_options` → `status` yields the expected final `SessionState` with the replaced options and updated status
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `src/core` exports `ConfigOption` and applies `config_options` deterministically
- No ACP SDK import anywhere in `src/core`
