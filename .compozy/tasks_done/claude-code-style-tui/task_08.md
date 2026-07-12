---
status: completed
title: "Status-bar slot contract"
type: backend
complexity: medium
dependencies: []
---

# Task 08: Status-bar slot contract

## Overview
Define the typed, hide-when-absent contract the dual-agent status bar reads: the `branch` field this reskin owns, plus `null`-returning `model` and `context` selectors that the delegated features fill later.
This is the seam that lets the bar ship honest today and light up additively with no layout reflow.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add an optional `branch?: string` field to `SessionState`, initialized `undefined` in `createSessionState`.
- MUST add a `ContextUsage` type (`{ used; size; percent }`) per the TechSpec "Core Interfaces".
- MUST add `selectSessionBranch(id)` returning the stored branch or `null`, following the curried per-session selector pattern.
- MUST add `selectSessionModel(id)` and `selectSessionContext(id)` that return `null` today (stub bodies), documented as filled by the `model-effort-selector` and `agent-usage-gauge` features.
- MUST NOT add `model`/`context` fields to `SessionState` (owned by the delegated packets) and MUST NOT read a field that does not exist.
</requirements>

## Subtasks
- [ ] 8.1 Add the optional `branch?` field to `SessionState` (default `undefined`).
- [ ] 8.2 Add the `ContextUsage` type.
- [ ] 8.3 Add `selectSessionBranch` reading the branch field.
- [ ] 8.4 Add `selectSessionModel`/`selectSessionContext` returning `null`, with a delegation doc-comment.
- [ ] 8.5 Add selector unit tests.

## Implementation Details
Modify `src/core/types.ts` (`SessionState`, new `ContextUsage`) and `src/store/selectors.ts`; add a selector test.
Follow the existing curried `Selector<T>` pattern (e.g. `selectSessionStatus`) so consumers `useMemo` the per-session selector.
See ADR-006 and the TechSpec "Core Interfaces" and "Data Models".

### Relevant Files
- `src/core/types.ts` — `SessionState` interface; add `branch?` and `ContextUsage`.
- `src/store/selectors.ts` — existing curried selectors to mirror.
- `src/core/sessionReducer.ts` — `createSessionState` (leave `branch` undefined).

### Dependent Files
- `src/core/sessionReducer.ts` + `src/app/controller.ts` (task_09) — populate `branch`.
- `src/ui/StatusStrip.tsx` (task_11) — consumes all three selectors.
- `agent-usage-gauge` / `model-effort-selector` packets — later wire the `model`/`context` selector bodies.

### Related ADRs
- [ADR-006: Status Bar - Typed Slot Contract, Delegated Data Plumbing, and Honest Hand-off Affordance](adrs/adr-006.md) — This task's core decision.

## Deliverables
- `branch?` field, `ContextUsage` type, and three narrow selectors (branch real; model/context stubbed `null`).
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test: a bar consuming the selectors hides the null slots **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `selectSessionBranch` returns `null` when `branch` is undefined and the value when set.
  - [ ] `selectSessionModel` and `selectSessionContext` return `null`.
  - [ ] Selectors are referentially stable for the same input (compatible with the `useMemo` subscription pattern).
- Integration tests:
  - [ ] A component reading the three selectors renders the branch slot and omits the model/context slots when they are `null`.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- No `model`/`context` field is added to `SessionState` (no duplication with delegated packets)
- The contract compiles and returns `null` cleanly before the delegated features land
