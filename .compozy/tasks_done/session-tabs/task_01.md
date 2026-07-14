---
status: completed
title: "Model session-tab workspace state and reducer"
type: refactor
complexity: high
---

# Task 01: Model session-tab workspace state and reducer

## Overview

Create the protocol-free workspace domain model that represents visible, background, and closed conversations independently from agent execution state. This establishes deterministic lifecycle, focus, and attention behavior without adding ACP, UI, or persistence concerns to the core.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST define protocol-free workspace lifecycle, availability, teardown, attention, and nullable-selection types without adding user lifecycle fields to `SessionState`.
2. MUST make an empty workspace with `selectedVisibleId: null` a valid state and preserve Background conversations when no Visible conversation remains.
3. MUST provide deterministic create, rename, select, adjacent navigation, background, reopen, and successful-close transitions with safe no-ops for unknown or Closed IDs.
4. MUST keep execution status ownership in `sessionReducer` while recording workspace attention epochs without clearing agent status.
5. MUST preserve immutable structural sharing for unaffected workspace entries and reject raw ACP errors or I/O concerns from this layer.
</requirements>

## Subtasks
- [x] 1.1 Define workspace-owned state and event vocabulary for conversation lifecycle and attention.
- [x] 1.2 Establish valid empty-workspace, selection, and order invariants.
- [x] 1.3 Provide deterministic lifecycle and adjacent-navigation transitions.
- [x] 1.4 Represent attention acknowledgement without changing execution status.
- [x] 1.5 Cover invalid, repeated, and final-visible-removal transitions with pure tests.

## Implementation Details

Create the core workspace boundary described in the TechSpec’s **Data Models**, **Workspace Lifecycle Rules**, and **Attention Rules** sections. Keep the existing session reducer responsible only for execution data; the store will later compose both pure state transitions.

### Relevant Files
- `src/core/types.ts` — existing protocol-free session and ID types to extend without ACP leakage.
- `src/core/sessionReducer.ts` — execution-state ownership boundary that must remain intact.
- `src/core/workspace.ts` — new pure workspace factory, reducer, and lifecycle helpers.
- `src/core/workspace.test.ts` — new exhaustive reducer and structural-sharing coverage.
- `src/core/sessionReducer.test.ts` — regression boundary proving workspace work does not alter session reduction.

### Dependent Files
- `src/store/appStore.ts` — will compose workspace and session state atomically.
- `src/store/selectors.ts` — will consume lifecycle, selection, and attention metadata.
- `src/app/controller.ts` — will perform runtime effects around pure workspace transitions.
- `src/persistence/runRecord.ts` — will serialize workspace metadata separately from execution descriptors.

### Related ADRs
- [ADR-004: Separate Workspace Metadata from Session State and Persist a Versioned Workspace](adrs/adr-004.md) — establishes the pure workspace ownership boundary.

## Deliverables
- Protocol-free workspace types, factory, reducer, and lifecycle helpers.
- Exhaustive reducer tests for lifecycle, focus, attention, no-op, and structural-sharing behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests exercising workspace and session-reducer boundaries **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Empty initialization keeps `selectedVisibleId` null and accepts Background-only state.
  - [x] Create, rename, select, cyclic previous/next, background, reopen, and close transitions produce the specified lifecycle and focus result.
  - [x] Attention ranks approval, error, and finished; selecting marks only the current epoch seen.
  - [x] Unknown IDs, invalid transitions, duplicate display names, and repeated events are safe no-ops with unchanged references.
- Integration tests:
  - [x] Apply workspace transitions alongside a `sessionReducer` fixture and confirm execution state/status remain unchanged.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing.
- Test coverage >=80%.
- Core workspace state is deterministic, protocol-free, and supports a valid empty workspace.
- Agent execution state remains exclusively owned by the existing session reducer.
