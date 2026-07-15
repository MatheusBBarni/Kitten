---
status: pending
title: Build the Pure Transcript Projection
type: refactor
complexity: medium
---

# Task 01: Build the Pure Transcript Projection

## Overview

Create the pure, dependency-free transcript projection that turns the authoritative live-run turn sequence into bounded presentation rows. This establishes the marker, protection, identity, and expansion contracts that every later task consumes without changing transcript semantics.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST create a pure src/core/transcriptProjection.ts module and colocated tests; it MUST import no UI, store, ACP, timer, config, or persistence surface.
2. MUST emit retained turn rows plus at most one counted history marker; disabled input MUST emit every authoritative turn in order with no marker.
3. MUST never collapse the recent tail, active streaming message, pending or in-progress tool rows, or an approval-owned tool row.
4. MUST preserve original Turn object references and use stable absolute-index turn keys plus a range-derived marker key.
5. MUST re-project supplied authoritative turns after an older tool update without a stale update cache or mutation.
</requirements>

## Subtasks

- [ ] Define the projection input, protection input, row, marker, and result contracts.
- [ ] Produce a contiguous retained suffix and one optional counted marker from immutable turns.
- [ ] Preserve all protected historical rows and the intervening suffix required by the single-marker contract.
- [ ] Support deterministic older-history expansion and full reveal.
- [ ] Add direct coverage for identity, old-tool updates, disabled behavior, and input immutability.

## Implementation Details

Create src/core/transcriptProjection.ts and src/core/transcriptProjection.test.ts. Follow the TechSpec Core Interfaces and Data Models sections; consume Turn only as the reducer-owned authoritative input. Task 04 consumes the resulting rows, so this task must not change src/core/sessionReducer.ts or the current ConversationView key contract.

### Relevant Files

- src/core/transcriptProjection.ts — new pure projection contract.
- src/core/transcriptProjection.test.ts — new deterministic Bun coverage.
- src/core/types.ts — read-only Turn, tool identity, and status definitions.
- src/core/sessionReducer.ts — read-only ordering and arbitrary-index tool-upsert contract.
- src/ui/ConversationView.tsx — read-only downstream stable-key contract.

### Dependent Files

- src/store/appStore.ts — task 02 composes the projection with transient state.
- src/store/selectors.ts — task 02 exposes the projection narrowly.
- src/ui/ConversationView.tsx — task 08 renders projection rows.

### Related ADRs

- [ADR-001: Ship a flagged bounded live transcript projection](adrs/adr-001.md) — Defines protected live-run behavior.
- [ADR-002: Launch bounded live history as a truth-first experiment](adrs/adr-002.md) — Requires a counted marker and explicit reveal.
- [ADR-003: Separate transcript projection from semantic session state](adrs/adr-003.md) — Establishes this pure-core boundary.

## Deliverables

- Pure projection module with typed input/output contracts.
- Colocated unit tests for protection, expansion, identity, disabled mode, and historical tool updates.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Core contract integration check with existing reducer ordering tests **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Empty, below-tail, and disabled inputs retain all ordered source turns with no marker.
  - [ ] A completed ten-turn fixture with a tail of three yields a seven-turn marker and absolute-index keys.
  - [ ] Increasing revealed history adds the immediately preceding turns and removes the marker only on full reveal.
  - [ ] Historical active stream, pending/in-progress tools, and approval-owned tools remain visible.
  - [ ] A same-index historical tool update changes visibility/count deterministically without mutating input.
  - [ ] Tail streaming preserves frozen turn references and unchanged row/marker keys.
- Integration tests:
  - [ ] Run the projection suite with the existing sessionReducer ordering/upsert tests to confirm the authoritative input contract.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every protected row remains visible and every collapsed count is exact.
- The module changes no reducer, ACP, or persistence behavior.
