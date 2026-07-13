---
status: completed
title: "selectSessionHeadroom selector"
type: backend
complexity: low
dependencies:
  - task_01
---

# Task 04: selectSessionHeadroom selector

## Overview
Add a primitive, per-agent curried selector that derives rounded remaining-context headroom, or `null` for unknown, preserving per-agent re-render isolation.
This is the single derived value both UI surfaces read.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `selectSessionHeadroom(sessionId)` returning `number | null` per the TechSpec "Core Interfaces" section (a rounded remaining-context percentage).
- MUST return `null` when the session has no usage or when `size <= 0` (honest unknown), never a fabricated `0`.
- MUST return a primitive so `Object.is` gives per-agent re-render isolation, mirroring `selectSessionStatus`.
- MUST NOT compute or persist headroom in domain state — derivation lives only in the selector (per ADR-003).
</requirements>

## Subtasks
- [x] 4.1 Implement the curried headroom selector reading `SessionState.usage`.
- [x] 4.2 Return `null` for the unknown cases (absent usage, `size <= 0`).
- [x] 4.3 Add selector tests for value, unknown, and re-render isolation.

## Implementation Details
Add the selector to `src/store/selectors.ts` next to `selectSessionStatus`, using the existing `Selector` type; consumers memoize the curried call per `sessionId`.
See TechSpec "Core Interfaces" for the signature and the rounding rule; do not duplicate it here.

### Relevant Files
- `src/store/selectors.ts` — the curried per-agent selector pattern (`selectSessionStatus`) and the `Selector` type.

### Dependent Files
- `src/store/selectors.test.ts` — add value and identity-stability tests.
- `src/ui/StatusStrip.tsx`, `src/ui/HandoffPreview.tsx` — consume it (tasks 06 and 07).

### Related ADRs
- [ADR-003: Headroom derivation](../adrs/adr-003.md) — primitive selector, computed not stored.

## Deliverables
- `selectSessionHeadroom` in `src/store/selectors.ts`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test asserting per-agent isolation across the store **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Usage `{ used: 124000, size: 200000 }` yields `38` (rounded remaining percent).
  - [x] No usage yields `null`; usage with `size: 0` yields `null`.
  - [x] `used === size` yields `0` (not `null`).
- Integration tests:
  - [x] After a usage event for agent A, `selectSessionHeadroom(B)` returns the same value and B's session slice keeps referential identity (isolation).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The selector returns a primitive `number | null`
- Per-agent re-render isolation is preserved
