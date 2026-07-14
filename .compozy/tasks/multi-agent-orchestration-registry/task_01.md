---
status: pending
title: "Add Pure Delegation State and Selectors"
type: backend
complexity: high
---

# Task 1: Add Pure Delegation State and Selectors

## Overview

Create the protocol-free domain model for a flat parent-child delegation graph. This task establishes the immutable lifecycle and aggregate selectors that all later runtime and UI work consume without importing ACP, store, or React concerns.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST model flat parent-child ownership using Kitten `SessionId` values, ordered child ids, explicit task/outcome text, parent and child generations, and no provider or ACP data.
2. MUST allow only `starting`, `running`, `needs_input`, `finished`, `failed`, and `cancelled` child lifecycle states, with immutable exactly-once terminal snapshots.
3. MUST reject self-children, duplicate registration, re-parenting, nesting, unknown ids, and stale generation publications as identity-preserving no-ops.
4. MUST expose pure ordered-child, aggregate-status, settled, terminal-outcome, and cleanup-eligibility selectors without clocks, timers, I/O, or mutable handles.
</requirements>

## Subtasks

- [ ] 1.1 Define protocol-free delegation entities and events beside existing session identity types.
- [ ] 1.2 Add a pure delegation reducer with exhaustive legal lifecycle transitions.
- [ ] 1.3 Add immutable aggregate and cleanup selectors for one parent’s child set.
- [ ] 1.4 Cover ownership, generation, terminal, and structural-sharing invariants with colocated tests.

## Implementation Details

Implement the TechSpec **Core Interfaces**, **Data Models**, and selector contract without coupling to `AppState`. Pass terminal timestamps through events instead of reading the clock in the pure core.

### Relevant Files

- `src/core/types.ts` — owns protocol-free `SessionId`-based domain types.
- `src/core/orchestration.ts` — new pure delegation reducer and selectors.
- `src/core/orchestration.test.ts` — new deterministic lifecycle and selector coverage.
- `src/core/workspace.ts` — reference for no-op identity and pure reducer conventions.

### Dependent Files

- `src/store/appStore.ts` — consumes immutable delegation state and reducer helpers.
- `src/store/selectors.ts` — exposes narrow app-level delegation selectors.
- `src/app/controller.ts` — supplies generation-checked lifecycle events and terminal timestamps.

### Related ADRs

- [ADR-001: Use a flat, host-owned delegation registry for V1](adrs/adr-001.md) — constrains graph shape and ownership.
- [ADR-003: Keep delegation state protocol-free and ephemeral in AppState](adrs/adr-003.md) — requires a pure projection.
- [ADR-004: Derive delegation completion from store selectors in V1](adrs/adr-004.md) — requires aggregate selectors.

## Deliverables

- Protocol-free delegation types, reducer, and selectors.
- Exhaustive colocated unit tests for all lifecycle and ownership invariants.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for delegation state consumption **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Registration creates ordered immutable ownership and rejects duplicate, self, nested, and re-parented children.
  - [ ] `starting → running → needs_input → running → finished` produces the expected immutable terminal snapshot.
  - [ ] Failed and cancelled terminal paths reject every later publication without changing the prior reference.
  - [ ] Parent or child generation mismatches, unknown ids, and duplicate events are no-ops.
  - [ ] Aggregate selectors distinguish active, needs-input, and fully settled groups while preserving unrelated selector identities.
- Integration tests:
  - [ ] A consumer can read ordered terminal outcomes for two children without importing runtime or ACP types.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- No pure-core import reaches store, controller, ACP, React, time, or I/O APIs.
- Every terminal child has one stable terminal snapshot and flat ownership remains valid.
