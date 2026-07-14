---
status: completed
title: "Expose the narrow per-session default-result selector"
type: backend
complexity: low
---

# Task 4: Expose the narrow per-session default-result selector

## Overview

Expose the reducer-owned terminal default-application result through a narrow selector for one session. Both existing feedback surfaces can then share a truthful result without coupling to controller logic, option mutation, or ACP types.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. The selector MUST return the stored DefaultApplyResult or null for unknown and untouched sessions.
- 2. The selector MUST project stored state directly without deriving values, mutating options, importing ACP, or owning UI copy.
- 3. It MUST retain reference stability across unrelated events.
- 4. Result subscribers MUST not be notified by a config-options refresh when the result is unchanged.
</requirements>

## Subtasks

- [ ] 4.1 Add a curried session-scoped result selector.
- [ ] 4.2 Preserve null behavior for unknown and untouched sessions.
- [ ] 4.3 Cover every terminal result variant.
- [ ] 4.4 Prove narrow subscription behavior.

## Implementation Details

Follow TechSpec Data Models and the existing per-session selector convention.

### Relevant Files

- src/store/selectors.ts — curried selector definitions.
- src/store/selectors.test.ts — store events and subscription stability tests.

### Dependent Files

- src/core/types.ts — DefaultApplyResult contract.
- src/core/sessionReducer.ts — reducer-owned result event.
- src/ui/ModelSelect.tsx and src/ui/StatusStrip.tsx — later consumers.

### Related ADRs

- [ADR-004: Sequence defaults from agent-confirmed model state](adrs/adr-004.md) — shared truthful result requirement.

## Deliverables

- Curried per-session default-result selector.
- Stable-reference and notification regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for store-to-UI selector compatibility **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Return null for unknown and newly created sessions before a result event.
  - [ ] Project none, applied, partial, and unavailable results unchanged.
  - [ ] Retain result reference after an unrelated-session event.
  - [ ] Notify in order for two result replacements.
  - [ ] Do not notify on a config-options-only refresh.
- Integration tests:
  - [ ] Read the selector through the real store and reducer events used by UI consumers.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- UI can subscribe to one session result without broad store reads.
- Confirmed model and effort remain outside selector derivation.
