---
status: completed
title: Harden per-session headroom validity
type: bugfix
complexity: low
---

# Task 01: Harden per-session headroom validity

## Overview

Make `selectSessionHeadroom` the shared, per-session validity boundary for usage-derived headroom. It must retain its `number | null` selector API and return a usable percentage only when the underlying counters and derived rounded result are valid.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. `selectSessionHeadroom` MUST remain a primitive `Selector<number | null>` owned by the requested session and MUST return `null` for missing usage, non-finite counters, or non-positive capacity.
2. The selector MUST compute the existing rounded percentage only for valid finite counters and MUST return `null` unless the rounded result is finite and inclusively within `0..100`.
3. Valid boundaries and existing normal rounding MUST remain visible as numbers, including `0%`, `38%`, and `100%`.
4. The task MUST NOT add application state, ACP changes, persistence, telemetry, formatter policy, or UI changes.
</requirements>

## Subtasks

1. Harden the per-session headroom selector while retaining its pure selector form and nullable API.
2. Add direct selector coverage for absent, non-finite, non-positive, and out-of-range usage values.
3. Prove valid boundary and representative rounded values are unchanged.
4. Preserve store-routed per-session isolation coverage for headroom selection.

## Implementation Details

### Relevant Files

- `src/store/selectors.ts` — own the shared headroom validity boundary.
- `src/store/selectors.test.ts` — extend direct selector and store-routed coverage.

### Dependent Files

- `src/core/types.ts` — existing `SessionUsage` shape; do not change it.
- `src/core/sessionReducer.ts` — existing usage-event routing; do not change it.
- `src/ui/StatusStrip.tsx` — existing nullable consumer of the selector.
- `src/ui/HandoffPreview.tsx` — existing nullable consumer of the selector.

### Related ADRs

- [ADR-001: Statusline Context Headroom Field](/Users/matheusbbarni/projects/kitten/.compozy/tasks/statusline-context-field/adrs/adr-001.md)
- [ADR-003: Shared Selector Validity and Context Ownership](/Users/matheusbbarni/projects/kitten/.compozy/tasks/statusline-context-field/adrs/adr-003.md)

## Deliverables

- A hardened `selectSessionHeadroom` that returns only valid finite integer percentages or `null`.
- Colocated selector tests covering invalid and valid boundary usage inputs, plus per-session isolation.
- Targeted test coverage at or above 80% for the changed selector behavior.

## Tests

### Unit Tests

- Assert missing usage, zero or negative capacity, `NaN`, and positive or negative infinity counters return `null`.
- Assert derived values below `0` or above `100` return `null`.
- Assert valid `used === size`, `124_000 / 200_000`, and `used === 0` return `0`, `38`, and `100` respectively.

### Integration Tests

- Route usage events through `createAppStore().applyEvent(...)` and prove the requested session's headroom is selected without changing another session's value or identity.

## Success Criteria

- `selectSessionHeadroom` rejects every invalid raw or derived value while preserving valid results.
- The selector remains pure, per-session, and `number | null` typed.
- All changed tests pass with at least 80% coverage for the implemented behavior.
