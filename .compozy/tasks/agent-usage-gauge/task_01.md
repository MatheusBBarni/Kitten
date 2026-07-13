---
status: completed
title: "Usage domain event, state field, and reducer case"
type: backend
complexity: medium
dependencies: []
---

# Task 01: Usage domain event, state field, and reducer case

## Overview
Introduce the raw context-usage fact into the domain core: a `SessionUsage` type, a `usage` domain event, an optional `SessionState.usage` field, and the reducer case that applies it.
This is the foundation the translation, selector, and UI all read, and it keeps the reducer's exhaustiveness guard compiling by adding the event arm and its case together.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST define `SessionUsage` as `{ used: number; size: number }` per the TechSpec "Core Interfaces" and "Data Models" sections, as a protocol-free domain type in `src/core/types.ts`.
- MUST add `{ kind: "usage"; used: number; size: number }` to the `DomainSessionEvent` union.
- MUST add an optional `usage?: SessionUsage` field to `SessionState`, left `undefined` in `createSessionState` (undefined is the honest "unknown", per ADR-001 and ADR-003).
- MUST implement the reducer `case "usage"` as a single-field replace that does not touch `turns` or derived fields, mirroring `case "status"`, keeping the `assertNever` guard compiling.
- MUST NOT capture `cost` and MUST NOT import the ACP SDK anywhere in `src/core` (translation is owned by the adapter layer).
</requirements>

## Subtasks
- [x] 1.1 Define the `SessionUsage` domain type and add the `usage` member to the `DomainSessionEvent` union.
- [x] 1.2 Add the optional `usage` field to `SessionState` and default it to `undefined` in `createSessionState`.
- [x] 1.3 Implement the reducer `case "usage"` as a wholesale single-field replace.
- [x] 1.4 Add reducer tests folding a usage event and confirming unrelated state and immutability.

## Implementation Details
Modify `src/core/types.ts` (the `DomainSessionEvent` union, the `SessionState` interface, and a new `SessionUsage` interface) and `src/core/sessionReducer.ts` (the event `switch` and `createSessionState`).
Mirror the existing `status` case exactly — a flat discriminant plus scalar fields, replacing one field and leaving derived state untouched. See TechSpec "Data Models" and "Core Interfaces".

### Relevant Files
- `src/core/types.ts` — the `DomainSessionEvent` union and `SessionState` live here; add the new arm, the optional field, and the `SessionUsage` type.
- `src/core/sessionReducer.ts` — `createSessionState` (initial state) and the event `switch`; the `assertNever` guard forces the new case.

### Dependent Files
- `src/core/sessionReducer.test.ts` — extend with usage-event folding and the `createSessionState` default.
- `src/agent/acpTranslate.ts` — will construct the new event (task_02).
- `src/store/selectors.ts` — will read the new field (task_04).

### Related ADRs
- [ADR-001: Ambient per-agent headroom gauge](../adrs/adr-001.md) — undefined `usage` is the honest "unknown".
- [ADR-003: Headroom derivation](../adrs/adr-003.md) — state holds the raw `{used,size}` fact only.

## Deliverables
- `SessionUsage` type, the `usage` `DomainSessionEvent` arm, and the optional `SessionState.usage` field.
- Reducer `case "usage"` and `createSessionState` default.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test exercising the reducer through `store.applyEvent` **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Folding `{ kind: "usage", used: 124000, size: 200000 }` sets `state.usage` to `{ used: 124000, size: 200000 }`.
  - [x] Folding a usage event leaves `turns`, `status`, `plan`, `referencedFiles`, and `pendingDiffs` unchanged.
  - [x] `createSessionState` returns `usage` as `undefined`.
  - [x] A second usage event replaces the prior `usage` value wholesale.
  - [x] The reducer does not mutate the input state object.
- Integration tests:
  - [x] `store.applyEvent(id, { kind: "usage", used, size })` updates that session's `usage` and preserves the other session's slice identity.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `tsc --noEmit` is clean with the new event kind handled (the `assertNever` guard compiles)
- No ACP SDK import appears in `src/core`
