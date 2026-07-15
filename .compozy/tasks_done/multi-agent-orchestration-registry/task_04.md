---
status: completed
title: "Harden Delegated Lifecycle and Parent Teardown"
type: backend
complexity: high
---

# Task 4: Harden Delegated Lifecycle and Parent Teardown

## Overview

Make delegated lifecycle settlement, parent replacement, and parent close race-safe. This task ensures children terminate exactly once, failures stay visible and isolated, and a parent cannot disappear while owned work is silently left behind.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST publish finished, failed, and cancelled child terminal states exactly once through the delegation contract, guarded by current runtime ownership and both generations.
2. MUST cascade a confirmed parent cancellation through existing child teardown paths and serialize repeated parent close requests.
3. MUST retain a visible child failure or teardown-failed outcome rather than silently deleting or detaching a child.
4. MUST cancel pending child interactions only through the existing interaction coordinator and ignore all later callbacks after close, replacement, restore, or disposal.
5. MUST preserve existing non-delegated conversation-close behavior.
</requirements>

## Subtasks

- [ ] 4.1 Publish exact-once terminal outcomes for normal completion, error, and confirmed cancellation.
- [ ] 4.2 Add parent replacement and close-intent handling for live owned children.
- [ ] 4.3 Cascade child cancellation and teardown through the existing controller path.
- [ ] 4.4 Preserve failed teardown visibility and sibling isolation.
- [ ] 4.5 Add deterministic races for terminal, close, replacement, and late callbacks.

## Implementation Details

Follow the TechSpec **Store and Controller Contract** and **Known Risks** sections. Reuse existing `closePromises`, `teardownState`, targeted cancellation, and interaction cancellation contracts; do not add a group completion promise or UI copy in this task.

### Relevant Files

- `src/app/controller.ts` — owns close promise deduplication, replacement, runtime generations, interaction cancellation, and teardown.
- `src/app/controller.test.ts` — owns deferred disposal, throwing cancel/dispose, late-event, replacement, and queue fixtures.
- `src/store/appStore.ts` — publishes delegated terminal state and retains visible failure state.
- `src/core/orchestration.ts` — enforces terminal immutability and group settlement.
- `src/app/actions.ts` — preserves the fail-soft close action boundary.

### Dependent Files

- `src/ui/TabDialog.tsx` — presents the delegated-parent confirmation over this lifecycle contract.
- `src/telemetry/recorder.ts` — records accepted terminal/cascade events without content.
- `test/sessionRestore.integration.test.ts` — proves old callbacks cannot publish into restored state.

### Related ADRs

- [ADR-001: Use a flat, host-owned delegation registry for V1](adrs/adr-001.md) — forbids orphaned delegated work.
- [ADR-003: Keep delegation state protocol-free and ephemeral in AppState](adrs/adr-003.md) — keeps lifecycle ownership split correctly.
- [ADR-004: Derive delegation completion from store selectors in V1](adrs/adr-004.md) — excludes waiter ownership.

## Deliverables

- Exact-once delegated terminal settlement and race-safe parent close/replacement behavior.
- Visible teardown-failure outcomes with isolated sibling behavior.
- Deterministic controller race coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for cascade close and replacement **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] One finished and one failed child settle once each; the group settles only after both terminal states.
  - [ ] Concurrent parent close calls share one operation and issue one cancellation/disposal attempt per child.
  - [ ] A close racing a child terminal event retains one stable terminal snapshot before parent removal.
  - [ ] Throwing child cancellation or disposal records visible failure while an unrelated sibling remains usable.
  - [ ] Late status, stream, permission, and clarification callbacks after close or failed teardown change no state.
- Integration tests:
  - [ ] Replacing or restoring a delegated parent while old child callbacks are pending leaves no live old ownership and cancels interactions exactly once.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Confirmed parent close never silently detaches a child.
- Existing ordinary conversation close tests remain green without behavioral changes.
