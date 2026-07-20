---
status: pending
title: Add CONTEXT to pure statusline and proposal contracts
type: backend
complexity: medium
---

# Task 02: Add CONTEXT to pure statusline and proposal contracts

## Overview

Extend the pure statusline contract with the literal `CONTEXT` field and its optional headroom value. The renderer and proposal protocol must remain strict and content-free: layouts identify `CONTEXT`, while rendering derives a percentage only from a valid supplied value.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. The closed simple statusline-kind contract and `StatuslineContext` MUST accept literal `CONTEXT` with optional `contextHeadroom?: number | null`, while core rendering stays pure.
2. Strict layout normalization and proposal-reply parsing MUST accept `CONTEXT` without weakening duplicate or unknown-field rejection.
3. `CONTEXT` MUST render exactly as `ctx <percentage>%` only for finite integers in `0..100`; `null`, non-finite, fractional, or out-of-range values MUST omit the field and any separator it would leave behind.
4. Width budgeting MUST preserve canonical trailing-field removal, including a narrow `FOLDER, CONTEXT` layout that keeps the folder when context does not fit.
5. The proposal instruction MUST enumerate literal `CONTEXT` only and MUST NOT expose resolved percentages, raw usage counters, state, config persistence, ACP, telemetry, or UI ownership.
</requirements>

## Subtasks

1. Add `CONTEXT` to the closed statusline-kind and context contracts.
2. Extend strict layout normalization and fenced proposal-reply parsing for the new literal identifier.
3. Render only valid supplied context headroom through the canonical renderer and preserve omission behavior.
4. Retain deterministic narrow-width trailing-field removal for context layouts.
5. Update proposal instructions and their contract tests to remain identifier-only.

## Implementation Details

### Relevant Files

- `src/core/statusline.ts` — closed field contract, strict normalization, and pure rendering.
- `src/core/statusline.test.ts` — parser, formatting, omission, and width-budget coverage.
- `src/app/statuslineFlow.ts` — proposal instruction contract.
- `src/app/statuslineFlow.test.ts` — proposal prompt and strict reply fixtures.

### Dependent Files

- `src/store/selectors.ts` — supplies the validated source value.
- `src/ui/StatusStrip.tsx` — saved-footer consumer of the canonical context.
- `src/ui/StatuslineOverlay.tsx` — captured-preview consumer of the canonical context.

### Related ADRs

- [ADR-001: Statusline Context Headroom Field](/Users/matheusbbarni/projects/kitten/.compozy/tasks/statusline-context-field/adrs/adr-001.md)
- [ADR-002: Context Proposal and Persistence Contract](/Users/matheusbbarni/projects/kitten/.compozy/tasks/statusline-context-field/adrs/adr-002.md)
- [ADR-003: Shared Selector Validity and Context Ownership](/Users/matheusbbarni/projects/kitten/.compozy/tasks/statusline-context-field/adrs/adr-003.md)

## Deliverables

- A strict, pure `CONTEXT` field contract and canonical renderer behavior.
- Identifier-only proposal instructions and strict reply parsing for `CONTEXT`.
- Colocated core and flow tests covering valid values, omission, width budgeting, and protocol constraints at or above 80% coverage.

## Tests

### Unit Tests

- Parse a `CONTEXT` layout while continuing to reject duplicate and unknown identifiers.
- Render `ctx 38%`, `ctx 0%`, and `ctx 100%`; omit context for `null`, `NaN`, infinities, fractions, and out-of-range values without malformed separators.
- Render a narrow `[FOLDER, CONTEXT]` layout and confirm canonical budgeting drops trailing context.

### Integration Tests

- Assert the proposal instruction names literal `CONTEXT` but contains no resolved percentage or usage counter.
- Parse a valid `CONTEXT` proposal reply through the existing strict statusline-flow path.

## Success Criteria

- `CONTEXT` is a strict literal layout identifier with a pure optional render value.
- Invalid context values cannot produce misleading output or separator artifacts.
- Proposal flow remains content-free and all changed tests pass with at least 80% coverage for the implemented behavior.
