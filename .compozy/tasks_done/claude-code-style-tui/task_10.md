---
status: completed
title: "Honest hand-off result"
type: refactor
complexity: low
dependencies: []
---

# Task 10: Honest hand-off result

## Overview
Change `handoff.begin()` from a bare boolean to a discriminated result carrying the reason it cannot run, so the status bar can explain why the hand-off is unavailable instead of silently doing nothing.
This replaces today's invisible no-op with an honest, surfaced state.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST change `HandoffFlow.begin()` to return `{ ok: true } | { ok: false; reason: "overlay-open" | "no-target" | "empty-source" }` per the TechSpec "Core Interfaces".
- MUST map each existing no-op guard to its corresponding reason.
- MUST preserve the existing success side-effects (open the preview, record the metric) and leave `confirm`/`cancel` unchanged.
- MUST update the `CockpitApp` key handler to consume the result rather than ignoring the return value.
</requirements>

## Subtasks
- [ ] 10.1 Define `HandoffBlockedReason` and `HandoffBeginResult`.
- [ ] 10.2 Return the mapped reason at each guard and `{ ok: true }` on success.
- [ ] 10.3 Update the `CockpitApp` hand-off key handler to consume the result.
- [ ] 10.4 Add unit tests for each reason and the success path.

## Implementation Details
Modify `src/app/handoff.ts` (the `begin` guards) and `src/ui/CockpitApp.tsx` (the `hand-off` key case), and update `src/app/handoff.test.ts`.
See ADR-006 and the TechSpec "Core Interfaces".

### Relevant Files
- `src/app/handoff.ts` — `begin()` guards (overlay open, no target, empty source).
- `src/ui/CockpitApp.tsx` — the `matchCommand` `hand-off` case that calls `begin()`.
- `src/app/handoff.test.ts` — existing hand-off assertions.

### Dependent Files
- `src/ui/StatusStrip.tsx` (task_11) — the hand-off affordance derives its reason from this contract.

### Related ADRs
- [ADR-006: Status Bar - Typed Slot Contract, Delegated Data Plumbing, and Honest Hand-off Affordance](adrs/adr-006.md) — The honest hand-off decision.

## Deliverables
- `begin()` returning a discriminated result; `CockpitApp` consuming it.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test: pressing the hand-off key on a blocked state does not crash and surfaces the reason **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `begin()` returns `{ ok: false, reason: "overlay-open" }` when an overlay is open.
  - [ ] `begin()` returns `{ ok: false, reason: "no-target" }` when the target agent is not ready.
  - [ ] `begin()` returns `{ ok: false, reason: "empty-source" }` when the source has no turns.
  - [ ] `begin()` returns `{ ok: true }` and opens the preview when valid.
- Integration tests:
  - [ ] Pressing the hand-off key with an empty source leaves the app stable and does not open the preview.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Every no-op condition maps to a distinct, surfaced reason
- Success side-effects and `confirm`/`cancel` behavior are unchanged
