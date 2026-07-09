---
status: completed
title: "Domain core types and session reducer"
type: backend
complexity: medium
dependencies:
  - task_01
---

# Task 02: Domain core types and session reducer

## Overview
Define Kitten's normalized domain model and the pure reducer that turns a stream of domain session events into a `SessionState`.
This is the stable core that the adapter, store, assembler, and UI all depend on, and it is deliberately free of ACP types and I/O so it can be exhaustively unit-tested.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST define the domain types from the TechSpec "Data Models" and "Core Interfaces" sections (`SessionState`, `Turn`, `ToolCallRecord`, `DomainSessionEvent`, `HandoffBundle`, `PendingDiff`, `AgentConfig`, `AppConfig`, `TelemetryEvent`).
- MUST implement a pure reducer that applies a `DomainSessionEvent` to a `SessionState` and returns a new state (no mutation, no I/O).
- MUST upsert tool calls by `toolCallId`, applying update semantics where omitted fields are preserved and explicit nulls clear fields.
- MUST derive `referencedFiles` from tool-call `locations` and collect `pendingDiffs` from `edit`-kind tool calls that are not yet applied.
- MUST NOT import the ACP SDK (the adapter layer owns translation into these domain types, per ADR-003).
</requirements>

## Subtasks
- [x] 2.1 Author the domain type definitions from the TechSpec data models
- [x] 2.2 Implement the pure `SessionState` reducer over `DomainSessionEvent`
- [x] 2.3 Implement tool-call upsert-by-id with field-preservation and null-clear semantics
- [x] 2.4 Derive `referencedFiles` and `pendingDiffs` as the reducer folds events
- [x] 2.5 Cover the reducer with fixtures for each event kind and edge case

## Implementation Details
Create the pure core module. See TechSpec "Data Models" and "Core Interfaces" for the exact type shapes; reference them rather than reproducing here. The reducer is the single writer of `SessionState` and must be deterministic and side-effect free.

### Relevant Files
- `src/core/types.ts` — new; all domain types
- `src/core/sessionReducer.ts` — new; the pure reducer
- `src/core/sessionReducer.test.ts` — new; fixture-driven unit tests

### Dependent Files
- `src/agent/acpTranslate.ts` (task_03) — produces the `DomainSessionEvent`s this reducer consumes
- `src/store/appStore.ts` (task_05) — applies the reducer to store slices
- `src/core/bundleAssembler.ts` (task_06) — reads `SessionState`

### Related ADRs
- [ADR-003: Layered Architecture with an ACP Anti-Corruption Layer](adrs/adr-003.md) — the core must not depend on ACP types

## Deliverables
- Domain type module and the pure reducer
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test that folds a scripted multi-event sequence into a final `SessionState` **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Applying an `agent_message` event with a new `messageId` appends a new agent turn
  - [x] A second `agent_message` with the same `messageId` concatenates `textDelta` onto the existing turn
  - [x] A `tool_call` then a `tool_call_update` for the same `toolCallId` merges, preserving omitted fields and clearing fields set to null
  - [x] An `edit`-kind tool call adds its path to `referencedFiles` as `"edited"` and its diff to `pendingDiffs`
  - [x] A `read`-kind tool call adds its path to `referencedFiles` as `"read"` and does not create a pending diff
  - [x] A `status` event updates `SessionState.status` without altering turns
- Integration tests:
  - [x] Folding a fixture sequence (user message → agent messages → two tool calls → status) yields the expected final `SessionState`
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The core module exports the TechSpec data-model types and a deterministic reducer
- No import of the ACP SDK anywhere in `src/core`
