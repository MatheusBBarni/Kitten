---
status: completed
title: "formatHeadroom pure display helper"
type: frontend
complexity: low
dependencies: []
---

# Task 05: formatHeadroom pure display helper

## Overview
Add a pure helper that turns a headroom percentage (or `null`) into a display label plus a fixed-width bar spec, with an explicit "unknown" marker.
It is shared by both surfaces so they never disagree, and it is neutral — no color verdict — per ADR-002.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `formatHeadroom(pct, cells?)` and `HEADROOM_UNKNOWN` in a new `src/ui/headroom.ts`, returning a label plus filled/total cells per the TechSpec "Core Interfaces" section.
- MUST render `null` as `HEADROOM_UNKNOWN` ("—") with zero filled cells (honest unknown).
- MUST clamp filled cells to `[0, cells]` and never throw on out-of-range input.
- MUST be pure — no store access, no palette, no color decisions — so both surfaces reuse it and it is unit-testable in isolation.
</requirements>

## Subtasks
- [x] 5.1 Define `HEADROOM_UNKNOWN` and the display return type.
- [x] 5.2 Implement the percent label plus fixed-width filled/track cell computation.
- [x] 5.3 Handle `null` and out-of-range inputs safely.
- [x] 5.4 Add unit tests across representative percentages and the unknown case.

## Implementation Details
Create a new pure module `src/ui/headroom.ts` (there is no existing bar/percentage utility in the codebase).
Keep it free of palette and color logic — the UI applies colors from the theme downstream. See TechSpec "Core Interfaces" for the signature and return shape.

### Relevant Files
- `src/ui/StatusStrip.tsx` — the consumer's `<span>` composition pattern that will color the label and bar downstream.

### Dependent Files
- `src/ui/headroom.test.ts` — new unit tests for this helper.
- `src/ui/StatusStrip.tsx`, `src/ui/HandoffPreview.tsx` — consume it (tasks 06 and 07).

### Related ADRs
- [ADR-002: Validation-gated honest MVP](../adrs/adr-002.md) — neutral presentation, no verdict.
- [ADR-003: Headroom derivation](../adrs/adr-003.md) — pure formatter separate from the selector.

## Deliverables
- `src/ui/headroom.ts` exporting `formatHeadroom` and `HEADROOM_UNKNOWN`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration verification via the UI consumers **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `formatHeadroom(38, 5)` returns label `"38%"` with 2 filled of 5 cells.
  - [x] `formatHeadroom(0, 5)` returns 0 filled cells; `formatHeadroom(100, 5)` returns 5 filled cells.
  - [x] `formatHeadroom(null)` returns label `HEADROOM_UNKNOWN` ("—") with 0 filled cells.
  - [x] Out-of-range input clamps: `formatHeadroom(130, 5)` fills all cells; a negative percent fills none; neither throws.
  - [x] The default cell count applies when `cells` is omitted.
- Integration tests:
  - [ ] The helper's output is consumed correctly by the status strip and handoff preview (verified in tasks 06 and 07).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The helper never throws and renders `null` as the unknown marker
- No store, palette, or color logic in the module
