---
status: completed
title: Controller Steering Orchestration
type: refactor
complexity: critical
---

# Task 05: Controller Steering Orchestration

## Overview

Implement the controller-owned effect runner that safely turns reducer state into a verified native action or the cancel-and-follow-up fallback. It must preserve interaction ownership, generation safety, explicit hard-stop behavior, and one visible terminal outcome for every accepted direction.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. `ControllerActions.steer()` MUST enqueue a non-empty direction for one captured active session, while ordinary `sendPrompt()` MUST fail closed before it records a competing user turn for that session.
- 2. The coordinator MUST read reducer state as its only lifecycle truth, wait for the targeted unresolved permission or clarification boundary, and never cancel or resolve that interaction on steering’s behalf.
- 3. The fallback MUST sequence cancellation, a named bounded terminal-settlement wait, and one ordered coalesced follow-up; timeout, cancellation failure, follow-up failure, or lifecycle loss MUST recover exact text once.
- 4. Every effect callback MUST be fenced by request id, session id, and generation; late or duplicate callbacks MUST be no-ops after recovery, close, crash, replacement, disposal, or hard stop.
- 5. `cancel()` MUST remain an explicit hard stop distinct from steering and safely terminalize in-flight steering without retrying or persisting raw text.
</requirements>

## Subtasks

- [ ] 5.1 Add the controller-owned per-session coordinator and injectable bounded-settlement timing seam.
- [ ] 5.2 Expose steering and recovery acknowledgement actions while rejecting ordinary active-turn prompt dispatch before transcript mutation.
- [ ] 5.3 Recheck safe interaction boundaries before cancellation and advance only after their normal settlement.
- [ ] 5.4 Wire close, provider error, session replacement, disposal, and explicit cancellation into one idempotent steering terminalization path.
- [ ] 5.5 Add deterministic deferred-promise coverage for delivery, recovery, timeout, and stale-generation races.

## Implementation Details

Follow the TechSpec “Data Flow,” “Integration Points,” “Known Risks,” and Build Order controller steps. Model effect ownership after `createInteractionCoordinator`: private timers and promises are allowed in the coordinator, but the reducer remains the only owner of queue, phase, and recovery truth.

### Relevant Files

- `src/app/steeringCoordinator.ts` — new per-session effect runner with safe-boundary checks, timers, and generation fencing.
- `src/app/actions.ts` — exposes `steer`, recovery acknowledgement, active-turn dispatch rejection, and hard-stop terminalization.
- `src/app/actions.test.ts` — new isolated action-boundary and target-capture coverage.
- `src/app/controller.ts` — creates coordinators and advances/terminalizes them on runtime lifecycle boundaries.
- `src/app/controller.test.ts` — real-store deferred-promise integration coverage for steering races.
- `src/core/steering.ts` — supplies reducer-owned phases, request identity, and terminal recovery transitions.
- `src/store/appStore.ts` — applies controller-dispatched events and acknowledgement through the single writer path.

### Dependent Files

- `src/agent/agentConnection.ts` — supplies guarded prompt/cancel transport and verified capability behavior.
- `src/telemetry/recorder.ts` — receives only allowlisted outcome hooks from controller-owned effects.
- `src/ui/PromptEditor.tsx` — invokes the action surface and renders selector state without owning effects.
- `test/fakeController.ts` — later UI fixtures require mechanical action-surface support.

### Related ADRs

- [ADR-001: Adopt a Lossless, Provider-Neutral Steering Contract for V1](adrs/adr-001.md) — defines singular active work and ordered intervention.
- [ADR-002: Make V1 Steering Lossless and Composer-First](adrs/adr-002.md) — requires visible recovery instead of automatic replay.
- [ADR-003: Model Steering as a Protocol-Free State Machine with a Controller Effect Runner](adrs/adr-003.md) — separates effect ownership from reducer truth.
- [ADR-004: Fail Closed on Native Steering and Recover Unsent Text on Lifecycle Loss](adrs/adr-004.md) — requires exact recovery on lifecycle loss.

## Deliverables

- A controller-owned, generation-fenced steering coordinator with named bounded settlement behavior.
- Action and controller lifecycle wiring that keeps normal prompt dispatch and hard stop distinct.
- Unit tests with 80%+ coverage of action/coordinator transitions and terminalization paths.
- Integration tests using real store plus injected connections for race, interaction, and lifecycle-loss scenarios.

## Tests

- Unit tests:
  - [ ] An active-session ordinary `sendPrompt` rejects before a user transcript turn is recorded, while `steer` accepts non-empty direction fail-softly.
  - [ ] The coordinator waits while its targeted permission or clarification is unresolved and resumes only after its normal settlement.
  - [ ] Deferred cancellation then terminal settlement produces one coalesced follow-up in chronological order.
  - [ ] Cancellation failure, settlement timeout, and follow-up failure each expose one exact recoverable outcome with no automatic resend.
  - [ ] A hard stop, close, crash, replacement, or disposal terminalizes once; late success cannot overwrite recovery.
- Integration tests:
  - [ ] Real store plus injected connections handles many ordered steering submissions, a safe interaction drain, and one delivered follow-up without a second active prompt.
  - [ ] Generation replacement and provider error preserve sibling-session behavior and recover the affected queued text exactly once.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every accepted steering item becomes either one delivered follow-up or one recoverable composer payload.
- Permission and clarification ownership remain unchanged during steering.
