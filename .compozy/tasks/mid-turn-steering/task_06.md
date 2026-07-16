---
status: completed
title: Composer Steering and End-to-End Behavior
type: frontend
complexity: high
---

# Task 06: Composer Steering and End-to-End Behavior

## Overview

Update the focused composer so an active task accepts direction as steering, communicates concise live status, and restores undelivered text without erasing a changed draft. Validate the full visible experience through existing OpenTUI and real ACP/controller integration harnesses.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. A non-empty ordinary composer submission during an active focused turn MUST call `actions.steer()` rather than `sendPrompt()` and MUST preserve the existing ready, restoration, command, history, and file-reference acceptance rules.
- 2. The composer MUST render compact explicit queued, sending, and failed steering status near the editor without relying on color alone or creating a status timeline.
- 3. Recovery MUST copy the exact one-time payload into an empty editor and acknowledge it; a non-empty changed draft MUST NOT be overwritten and MUST receive a clear recovery notice instead.
- 4. Escape and the explicit hard stop MUST remain visibly and behaviorally distinct from steering.
- 5. The UI MUST NOT call transport/store mutation directly, automatically resend recovered text, persist recovery content, or change permission/clarification ownership.
</requirements>

## Subtasks

- [ ] 6.1 Route active-session submission through the steering action while preserving ordinary submission behavior when idle.
- [ ] 6.2 Render compact accessible phase and recovery indicators from narrow selectors.
- [ ] 6.3 Restore and acknowledge one recovery draft without replacing a changed non-empty editor buffer.
- [ ] 6.4 Extend the UI controller fixture for steering and acknowledgement call assertions.
- [ ] 6.5 Add rendered and real adapter/controller/UI scenarios for queued, sending, failed, recovery, and interaction attribution.

## Implementation Details

Follow the TechSpec “Data Flow,” “Testing Approach,” and “Known Risks” sections. Preserve `PromptEditor`’s current command precedence, textarea ownership, modal routing, prompt-history behavior, accepted `@` references, and Escape handling; this task consumes controller actions/selectors rather than reproducing lifecycle logic.

### Relevant Files

- `src/ui/PromptEditor.tsx` — routes accepted active-turn submissions, renders compact status, and performs one-time draft recovery.
- `src/ui/PromptEditor.test.tsx` — OpenTUI rendered coverage for editor routing, keyboard behavior, history, references, and status/recovery frames.
- `test/fakeController.ts` — extends UI action spies for steering and recovery acknowledgement.
- `test/midTurnSteering.integration.test.tsx` — new real adapter/controller/store/UI lifecycle coverage using the in-memory transport harness.
- `test/mockAgent.ts` — supplies any needed deterministic cancel/settlement seam for fallback integration assertions.

### Dependent Files

- `src/app/actions.ts` — provides the steering, hard-stop, and recovery acknowledgement surface.
- `src/store/selectors.ts` — supplies narrow phase/count/recovery projections.
- `src/ui/CockpitApp.tsx` — continues to own editor mounting and overlay composition without steering logic.
- `test/clarificationLifecycle.integration.test.tsx` — provides the real ACP/controller/UI interaction-attribution pattern to preserve.

### Related ADRs

- [ADR-001: Adopt a Lossless, Provider-Neutral Steering Contract for V1](adrs/adr-001.md) — requires visible singular active work.
- [ADR-002: Make V1 Steering Lossless and Composer-First](adrs/adr-002.md) — selects compact composer status and exact recovery.
- [ADR-003: Model Steering as a Protocol-Free State Machine with a Controller Effect Runner](adrs/adr-003.md) — keeps UI out of lifecycle and transport ownership.
- [ADR-004: Fail Closed on Native Steering and Recover Unsent Text on Lifecycle Loss](adrs/adr-004.md) — requires one-time non-persistent recovery.

## Deliverables

- Active-turn composer routing through the steering action with unchanged idle submission behavior.
- Accessible compact queued, sending, and failed status plus safe one-time recovery draft handling.
- Rendered UI tests with 80%+ coverage of changed composer behavior.
- Real adapter/controller/store/UI integration tests for ordered fallback and preserved interaction attribution.

## Tests

- Unit tests:
  - [ ] A pending active turn routes a typed non-empty editor submission to `steer` and never to competing `sendPrompt`.
  - [ ] Idle submission retains ordinary history, file-reference, command, whitespace, and ready/restoration gate behavior.
  - [ ] Queued, sending, and failed states render explicit readable text without color-only meaning.
  - [ ] An exact recovery payload fills an empty textarea once and acknowledgement clears it from the projection.
  - [ ] A changed non-empty draft remains untouched while the editor presents a recovery notice, and Escape still invokes only hard cancel while working.
- Integration tests:
  - [ ] A real pending prompt receives multiple ordered steering directions, waits through a scripted permission or clarification, and produces one ordered follow-up after safe settlement.
  - [ ] Cancellation or delivery failure renders failed state and exact recovery text without concurrent prompt dispatch or automatic resend.
  - [ ] The scripted permission or clarification remains attributable to the interrupted original turn throughout the steering flow.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Developers can distinguish queued, sending, failed, and explicit stop behavior from the composer alone.
- Recovery never silently loses or overwrites developer text.
