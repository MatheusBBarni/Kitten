---
status: completed
title: "Command domain slice: type, event, and reducer field"
type: backend
complexity: medium
dependencies: []
---

# Task 01: Command domain slice: type, event, and reducer field

## Overview
Add a protocol-free `AvailableCommand` type and a per-session `commands` list to the domain core so the store can hold each focused agent's advertised commands.
This is the foundation the translation (task_02), the selector (task_03), and the menu UI (task_07) all build on, and it mirrors the existing `configOptions` slice exactly.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a protocol-free `AvailableCommand` type (`name`, `description`, optional `hint`) in `src/core/types.ts`, carrying no ACP wire type, per the TechSpec "Core Interfaces" section and ADR-003.
- MUST add a `{ kind: "commands"; commands: AvailableCommand[] }` variant to `DomainSessionEvent` and a `commands: AvailableCommand[]` field to `SessionState`.
- MUST initialize `commands: []` in `createSessionState` and add a reducer case that wholesale-replaces `commands` (latest-wins), mirroring the existing `config_options` case.
- MUST keep the `assertNever` exhaustiveness guard satisfied so the compiler enforces the new case.
- MUST NOT alter transcript turns or any other `SessionState` field when handling a `commands` event.
</requirements>

## Subtasks
- [x] 1.1 Define the `AvailableCommand` domain type alongside `ConfigOption` in `types.ts`.
- [x] 1.2 Add the `commands` variant to the `DomainSessionEvent` union.
- [x] 1.3 Add the `commands` field to `SessionState` and initialize it in `createSessionState`.
- [x] 1.4 Add the wholesale-replace reducer case, mirroring `config_options`.
- [x] 1.5 Add reducer unit tests for replace, empty init, and non-interference.

## Implementation Details
Follow the `configOptions` slice as the template end to end; it is the closest match (protocol-free list, wholesale-replace).
See the TechSpec "Implementation Design > Core Interfaces" and "Data Models" sections for the exact shapes; do not duplicate them here.

### Relevant Files
- `src/core/types.ts` - defines `DomainSessionEvent`, `SessionState`, and `ConfigOption` (the shape template for `AvailableCommand`).
- `src/core/sessionReducer.ts` - holds the `config_options` case, `createSessionState` initializer, and the `assertNever` guard to mirror.
- `src/core/sessionReducer.test.ts` - colocated reducer tests to extend.

### Dependent Files
- `src/agent/acpTranslate.ts` - task_02 emits the new `commands` event.
- `src/store/selectors.ts` - task_03 reads the new `commands` field.
- `src/ui/PromptEditor.tsx` - task_07 consumes the field via the selector.

### Related ADRs
- [ADR-003: Surface agent commands as a config_options-style domain slice](../adrs/adr-003.md) - defines the type, event, reducer, and no-ACP-leak constraint this task implements.

## Deliverables
- `AvailableCommand` type, `commands` event variant, and `SessionState.commands` field.
- Reducer case wholesale-replacing `commands`, plus the `createSessionState` initializer.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test that a `commands` event applied through the reducer updates `SessionState.commands` **(REQUIRED)**

## Tests
- Unit tests:
  - [x] A `commands` event with two commands sets `SessionState.commands` to exactly those two.
  - [x] A second `commands` event fully replaces the previous list (no merge, no append).
  - [x] `createSessionState` yields `commands: []` for a fresh session.
  - [x] Applying an unrelated event (e.g. `status`) leaves `commands` unchanged and preserves its reference identity.
- Integration tests:
  - [x] Applying a `commands` event through the store/reducer round-trip lands the list on the addressed session and leaves other sessions untouched.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The `commands` slice mirrors the `configOptions` pattern (type, event, reducer, initializer).
- `bun run typecheck` passes with the `assertNever` guard satisfied by the new reducer case.
