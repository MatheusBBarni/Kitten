---
status: completed
title: Coordinate confirmed hard-stop continuation dispatch
type: refactor
complexity: critical
---

# Task 04: Coordinate confirmed hard-stop continuation dispatch

## Overview

Add the controller-owned effect coordinator that captures an explicit hard stop, waits for the attested terminal boundary, records the closed checkpoint, and sends one queued continuation through the ordinary prompt path. Any loss of proof must retain the draft locally and leave `/new` as the safe recovery route.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. An explicit hard stop MUST capture the active lifecycle identity before cancellation and MUST preserve a healthy ACP session when the proof path succeeds.
- 2. The controller MUST await provider-attested cancellation acceptance and terminal settlement before it dispatches a continuation.
- 3. Exactly one queued continuation MUST dispatch through the ordinary prompt path, without steering, a concurrent request, or a duplicated harness.
- 4. A second Escape while continuation dispatch is pending MUST restore the queued draft locally and MUST NOT send another provider cancellation.
- 5. Timeout, error, indeterminate first delivery, generation replacement, disposed session, or capability loss MUST fail closed, retain the draft visibly, and MUST NOT dispatch.
- 6. Steering, approval, clarification, and delegated-child ownership MUST retain their existing precedence and cancellation semantics.
</requirements>

## Subtasks

- [ ] 4.1 Expose narrow controller actions for queueing, recovering, and acknowledging continuation ownership.
- [ ] 4.2 Replace the current generic cancellation ordering for an eligible Hard Stop: capture its active lifecycle before transport cancellation and do not terminalize its first-delivery checkpoint prematurely.
- [ ] 4.3 Build the controller effect coordinator around captured lifecycle, generation, request, and capability identities; require the Task 02 verdict before it can advance.
- [ ] 4.4 Invoke Task 03's settled-interrupted transition only after accepted cancellation and captured-lifecycle terminal settlement.
- [ ] 4.5 Re-enter the existing `preparePromptDispatch()` path exactly once after all identities still hold, so the follow-up retains ordinary-turn and harness admission semantics.
- [ ] 4.6 Restore local recovery for proof loss and second-Escape withdrawal without another provider cancel, then cover deferred settlement, lifecycle replacement, cancellation, disposal, and no-double-dispatch races.

## Implementation Details

Follow the TechSpec “Controller Effect Coordinator,” “Dispatch and Recovery Rules,” and “Race Matrix” sections. Keep asynchronous authority in the controller; reducer events are the only session-state mutation path. The existing `actions.cancel()` calls `terminalizePromptDispatch()` before `connection.cancel()`, and the injected controller handler currently converts an in-flight first harness to `dispatch_indeterminate`. The eligible Hard Stop path must instead capture the exact `ActivePromptLifecycle`, request cancellation, await its settlement and the attested verdict, then choose Task 03's closed checkpoint or recovery. Generic cancellation remains fail-closed.

### Relevant Files
- `src/app/actions.ts` — public controller actions and normal prompt dispatch boundary.
- `src/app/controller.ts` — owns `activePrompts`, `beginPromptLifecycle()`, `finishPromptLifecycle()`, dispatch preparation, cancellation injection, lifecycle cleanup, and generation rechecks.
- `src/app/postInterruptContinuationCoordinator.ts` — new controller effect coordinator.
- `src/app/postInterruptContinuationCoordinator.test.ts` — new focused deferred-race tests.
- `src/app/controller.test.ts` — end-to-end controller and harness dispatch coverage.

### Dependent Files
- `src/core/postInterruptContinuation.ts` and `src/core/sessionReducer.ts` — own lifecycle state and transitions.
- `src/config/hardStopContinuationCapability.ts` — supplies the protocol-free attested verdict.
- `src/app/harnessDelivery.ts` — Task 03 owns the closed settled-interrupted checkpoint transition; this coordinator may invoke it only after proof.
- `src/app/steeringCoordinator.ts` — supplies an existing captured-lifecycle/settlement pattern but remains a separate interaction path and must not be repurposed.

### Related ADRs
- [ADR-002: Preserve one safe continuation with explicit recovery](adrs/adr-002.md) — defines recovery and one-dispatch scope.
- [ADR-003: Keep continuation lifecycle reducer-owned and effect coordination in the controller](adrs/adr-003.md) — defines effect ownership.
- [ADR-004: Require attested settlement and metadata-only persistence](adrs/adr-004.md) — defines proof and checkpoint ordering.

## Deliverables

- Controller actions and a dedicated post-interrupt effect coordinator.
- Guarded checkpoint transition and ordinary one-shot dispatch.
- Controller and coordinator race coverage.

## Tests

- Unit tests:
  - [ ] The coordinator rejects missing capability, stale generation, changed lifecycle, and duplicate request identities.
  - [ ] It waits for cancellation acceptance and terminal settlement before dispatching.
  - [ ] It leaves the first harness checkpoint in flight while proof is pending, records `settled_interrupted` only after both proof conditions, and falls back to the Task 03 indeterminate state on ambiguity.
  - [ ] Second-Escape recovery restores blocks without an additional provider cancel.
- Integration tests:
  - [ ] A confirmed hard stop sends one ordinary follow-up with no steering route and no duplicate harness.
  - [ ] A deferred cancellation acceptance, deferred terminal settlement, and their reversed completion order never dispatch early; their duplicate or late callbacks remain inert.
  - [ ] Timeout, rejected cancellation, terminal error, first-delivery indeterminacy, session disposal, and generation replacement retain recovery and send nothing.
  - [ ] Active steering, approval, clarification, and delegated-child interactions keep their prior ownership.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The only automatic continuation is proof-gated, same-session, ordinary prompt dispatch.
- Every uncertain branch visibly preserves a local draft and prevents unsafe send.
