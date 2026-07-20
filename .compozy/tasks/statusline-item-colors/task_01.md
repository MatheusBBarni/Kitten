---
status: pending
title: Extend Core Statusline Color Contract
type: refactor
complexity: medium
---

# Task 01: Extend Core Statusline Color Contract

## Overview

Extend the pure statusline model so an existing field can carry one optional,
canonical foreground color without changing the behavior of legacy layouts.
This creates the single fail-closed boundary shared by configuration, agent
proposals, preview, and active-footer rendering.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- Accept only a maintained closed set of known CSS names and exact opaque six-digit RGB hex input; normalize every accepted value to uppercase `#RRGGBB`.
- Preserve simple-string items and existing `ELLIPSIS_BRANCH` validation, duplicate detection, grapheme handling, printable rules, and width behavior.
- Allow a structured simple item to contain exactly `kind` and `color`, and a structured ellipsis item to contain only its existing fields plus optional `color`.
- Reject unknown names, malformed or alpha hex, transparency, terminal-control content, non-object values, and unexpected item keys without fallback.
- Carry an optional canonical color on statusline segments for field text only; keep `statuslineText()` and separator text color-free.
</requirements>

## Subtasks

- [ ] 1.1 Define the closed canonical color and structured-item contract in the pure statusline domain.
- [ ] 1.2 Preserve valid legacy layouts while rejecting unsupported color inputs and object shapes.
- [ ] 1.3 Make rendered field segments retain their canonical color without changing text selection or width accounting.
- [ ] 1.4 Cover valid names and hex values, canonicalization, invalid inputs, legacy layouts, and constrained rendering behavior.

## Implementation Details

Use the core interfaces and invariants in the TechSpec's Implementation Design.
Keep this layer free of theme lookup, OpenTUI elements, terminal control
sequences, configuration I/O, and agent orchestration.

### Relevant Files

- `src/core/statusline.ts` — closed item, color, normalization, and segment contracts.
- `src/core/statusline.test.ts` — focused acceptance, rejection, compatibility, and rendering-contract coverage.

### Dependent Files

- `src/config/configLoader.ts` — consumes the normalized layout as the persisted preference boundary.
- `src/app/statuslineFlow.ts` — routes agent proposal content through this contract.
- `src/ui/StatusStrip.tsx` — later consumes color-bearing segments without interpreting them.

### Related ADRs

- [ADR-001: Keep statusline colors item-local and declarative](adrs/adr-001.md) — establishes the field-only, non-executable boundary.
- [ADR-003: Carry canonical colors through the pure statusline model](adrs/adr-003.md) — selects the canonical core contract and color-bearing segments.

## Deliverables

- A strict, canonical color-aware statusline model in `src/core/statusline.ts`.
- Color-bearing render segments that retain current text and width semantics.
- Focused unit coverage for accepted, rejected, legacy, and boundary cases.
- Core rendering-contract coverage exercised through its public layout and segment APIs.

## Tests

- Unit tests:
  - [ ] Known supported names and lowercase six-digit hex normalize to canonical uppercase RGB.
  - [ ] Unknown names, short or long hex, alpha/RGBA forms, `transparent`, ANSI/control content, arrays, and extra keys fail closed.
  - [ ] Legacy simple items and existing ellipsis layouts remain valid with their prior text and width behavior.
  - [ ] Structured simple and ellipsis items carry only canonical colors to field segments; separators and flattened text remain color-free.
- Integration tests:
  - [ ] Public normalization-to-rendering flow retains canonical color metadata while preserving unavailable-field omission and constrained width behavior.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- The core exposes one deterministic color acceptance boundary and no renderer-specific parser.
- Valid legacy layouts produce the same flattened statusline text as before.
- Invalid color-bearing layouts never produce a normalized layout or renderable segment.
- All focused tests pass with >=80% targeted coverage.
