---
status: pending
title: "Add Pure Prompt-History Reducer"
type: backend
complexity: medium
---

# Task 1: Add Pure Prompt-History Reducer

## Overview

Create the protocol-free state transitions that make prompt recall deterministic before the state is connected to a Kitten session. This task establishes the 50-entry, adjacent-duplicate, and navigation semantics used by all later work.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add a pure prompt-history module under `src/core/` with a fixed capacity of 50 entries.
2. MUST retain entries in chronological order, collapse only adjacent exact duplicates, and avoid text normalization.
3. MUST distinguish a no-replacement navigation result from the empty-string result that clears after the newest recalled entry.
4. MUST clamp older/newer navigation at both ends without wrapping.
5. MUST not import React, OpenTUI, ACP, store, telemetry, or other I/O dependencies.
</requirements>

## Subtasks

- [ ] 1.1 Define the immutable prompt-history state and navigation result contract described by the TechSpec’s Core Interfaces section.
- [ ] 1.2 Add bounded recording with adjacent-duplicate collapse and a reset recall cursor.
- [ ] 1.3 Add previous and next navigation behavior, including the clear-after-newest transition.
- [ ] 1.4 Expose selection helpers that let later layers consume history without duplicating transition logic.
- [ ] 1.5 Add exhaustive pure-state regression coverage.

## Implementation Details

Create the isolated core policy described in the TechSpec’s **Core Interfaces** and **Data Models** sections. Keep session integration out of this task; the pure module must be usable by `sessionReducer` without importing any outer layer.

### Relevant Files

- `src/core/sessionReducer.ts` — establishes the repository’s pure, immutable reducer conventions that this module must match.
- `src/core/shellReducer.ts` — existing bounded-history precedent in the protocol-free core.
- `src/core/types.ts` — later consumer of the history state contract; inspect for naming and readonly conventions.

### Dependent Files

- `src/core/types.ts` — will import or expose the resulting history state in the following task.
- `src/core/sessionReducer.ts` — will delegate prompt-history events to this module.
- `src/core/promptHistory.test.ts` — validates this task’s transitions directly.

### Related ADRs

- [ADR-003: Store Bounded Prompt History in Each Session Slice](adrs/adr-003.md) — requires a 50-entry pure state model.
- [ADR-001: Scope Prompt Recall to the Active Agent Session](adrs/adr-001.md) — defines the non-persistent, session-local boundary.

## Deliverables

- `src/core/promptHistory.ts` with the bounded immutable history policy.
- `src/core/promptHistory.test.ts` with direct state-transition coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for prompt-history state transitions **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Recording two different strings retains them oldest-to-newest and clears the recall cursor.
  - [ ] Recording the same text twice consecutively leaves exactly one entry.
  - [ ] Recording 51 distinct prompts evicts only the oldest entry and retains the newest 50.
  - [ ] Previous navigation starts at the newest entry, reaches the oldest entry, and remains there on another previous command.
  - [ ] Next navigation walks toward the newest entry, then returns an empty string and leaves recall mode.
  - [ ] Unicode and multiline prompt text round-trips unchanged and input state references remain immutable.
- Integration tests:
  - [ ] A record followed by previous/next calls uses the complete transition path and returns the expected selected text at every step.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The core module enforces the 50-entry cap, duplicate rule, and both navigation endpoints without outer-layer imports.
- Later tasks can consume a single selection result instead of recreating history rules.
