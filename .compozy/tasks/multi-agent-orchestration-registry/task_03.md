---
status: pending
title: "Add Controller-Owned Delegated Child Launch"
type: backend
complexity: high
---

# Task 3: Add Controller-Owned Delegated Child Launch

## Overview

Extend the controller and its UI action boundary to launch a child from an active parent without changing focus. The controller must own task dispatch, runtime registration, generation fencing, and fail-soft child control while retaining the existing ACP anti-corruption boundary.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST expose narrow `startDelegatedChild`, steer, and cancel commands through `ControllerActions`; UI code MUST NOT access connections or runtimes directly.
2. MUST inherit the parent provider and working directory, retain parent focus, and dispatch only the submitted task/outcome to the new child.
3. MUST capture and verify both parent and child generations plus current runtime-map ownership before every lifecycle publication.
4. MUST leave an inspectable failed child snapshot when startup or prompt dispatch fails, while parent and siblings remain usable.
</requirements>

## Subtasks

- [ ] 3.1 Add the delegated command contracts to the controller action boundary and test fake.
- [ ] 3.2 Refactor private conversation creation to support background child startup from a captured parent.
- [ ] 3.3 Dispatch explicit child task/outcome text through the existing prompt path.
- [ ] 3.4 Publish generation-fenced running, attention, and startup-failure state.
- [ ] 3.5 Add deterministic multi-child and stale-event controller coverage.

## Implementation Details

Use the TechSpec **Store and Controller Contract** and **API Endpoints** sections. Reuse `AgentRuntime`, `registerRuntime`, `startSession`, `acceptsRuntimeEvents`, and existing fail-soft error reporting; do not create a second runtime registry.

### Relevant Files

- `src/app/controller.ts` — owns runtime map, session start, event guards, and prompt/cancel lifecycle.
- `src/app/actions.ts` — owns `ControllerActions` and action dependency contracts.
- `src/app/controller.test.ts` — owns injected connection, prompt, cancellation, and lifecycle race fixtures.
- `test/fakeController.ts` — provides complete typed action implementations for UI tests.
- `src/store/appStore.ts` — supplies atomic delegated registration and lifecycle publication.
- `src/core/orchestration.ts` — supplies generation-bearing child snapshots and transitions.

### Dependent Files

- `src/ui/DelegationDialog.tsx` — invokes the launch action and handles fail-soft results.
- `src/ui/TabWorkspace.tsx` — renders the published Running state.
- `src/ui/SessionsOverlay.tsx` — renders child lifecycle and navigation.

### Related ADRs

- [ADR-001: Use a flat, host-owned delegation registry for V1](adrs/adr-001.md) — keeps the host responsible for lifecycle.
- [ADR-002: Prioritize fast, explicit child launch in the MVP](adrs/adr-002.md) — requires retained parent focus and immediate Running feedback.
- [ADR-003: Keep delegation state protocol-free and ephemeral in AppState](adrs/adr-003.md) — separates state projection from live runtimes.
- [ADR-004: Derive delegation completion from store selectors in V1](adrs/adr-004.md) — excludes a new completion promise.

## Deliverables

- Controller-owned delegated launch, steer, and cancel action surface.
- Generation-fenced lifecycle publication and failed-start snapshot behavior.
- Typed fake-controller support and deterministic controller coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for parent/child launch lifecycle **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] A deterministic child inherits parent provider/CWD, stays backgrounded, and receives only the submitted task/outcome prompt.
  - [ ] Two child launches create distinct runtimes while the parent remains selected.
  - [ ] Child startup or prompt failure publishes an inspectable failed child without breaking parent or sibling prompts.
  - [ ] Unknown, terminal, stale, and non-owned steer/cancel calls are fail-soft no-ops.
  - [ ] A replaced parent or child ignores later stale lifecycle publication using both captured generations.
- Integration tests:
  - [ ] An injected connection drives launch, prompt, Running state, and one child interaction without real agent binaries.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Launch never changes parent focus and never exposes an ACP type to UI/store/core code.
- Every accepted child lifecycle update is fenced by current parent and child generation.
