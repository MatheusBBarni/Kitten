---
status: pending
title: "Add controller-owned default application and content-free outcome telemetry"
type: backend
complexity: high
---

# Task 5: Add controller-owned default application and content-free outcome telemetry

## Overview

Add the controller action that resolves one session's provider default and applies it through the existing confirmed option path. It owns model-then-refreshed-effort sequencing, records one reducer-owned terminal result, and emits only an opt-in content-free outcome category.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. ControllerActions MUST expose one fail-soft default-application action addressed to a session.
- 2. The controller MUST own a replaceable provider-default snapshot outside app-store preference state.
- 3. The action MUST apply model before effort and resolve effort only from refreshed agent-confirmed options.
- 4. None, unavailable, applied, and partial outcomes MUST reduce exactly one truthful terminal result.
- 5. The action MUST not roll back optimistically, substitute values, throw into React, or expose non-model/effort categories.
- 6. Telemetry MUST record only a bounded terminal category and MUST contain no model, effort, prompt, code, error, or adapter values.
</requirements>

## Subtasks

- [ ] 5.1 Add controller-owned provider-default snapshot ownership.
- [ ] 5.2 Add one fail-soft action to ControllerActions.
- [ ] 5.3 Preserve model-before-refreshed-effort confirmation.
- [ ] 5.4 Record reducer-owned terminal outcomes.
- [ ] 5.5 Add opt-in content-free outcome observation.
- [ ] 5.6 Cover success, partial, unavailable, and error paths.

## Implementation Details

Implement TechSpec Default Application Algorithm, Integration Points, and Monitoring and Observability through existing controller and action seams. Reuse option actions and do not add ACP imports outside the adapter.

### Relevant Files

- src/app/actions.ts — action surface and confirmed option path.
- src/app/controller.ts — session registry and defaults snapshot.
- src/app/controller.test.ts — adapter call-order and outcome tests.
- src/telemetry/recorder.ts — local opt-in recorder.
- src/telemetry/recorder.test.ts — bounded event/privacy coverage.
- test/telemetry.integration.test.ts — JSONL content checks.

### Dependent Files

- src/core/types.ts and src/core/sessionReducer.ts — completed result contract.
- src/config/configLoader.ts — resolved provider defaults.
- src/index.ts — later reload bridge.
- test/fakeController.ts — later UI action fake.

### Related ADRs

- [ADR-003: Keep provider defaults declarative and controller-owned](adrs/adr-003.md) — controller ownership and no writes.
- [ADR-004: Sequence defaults from agent-confirmed model state](adrs/adr-004.md) — ordered confirmed outcomes.

## Deliverables

- Controller defaults snapshot update seam outside UI actions.
- Fail-soft default-application action and terminal outcomes.
- Opt-in local content-free terminal telemetry.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for controller, adapter, and telemetry behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] No default emits none, makes no adapter call, and retains confirmed state.
  - [ ] A stale model emits unavailable-model with no adapter call.
  - [ ] A valid pair calls model before refreshed effort.
  - [ ] Confirmed model plus unavailable/rejected effort emits partial with no rollback or substitution.
  - [ ] Not-ready session and model transport failure fail softly with existing error routing.
  - [ ] Duplicate-provider sessions share the default but target only their addressed runtime.
- Integration tests:
  - [ ] Enabled telemetry records only none, applied, partial, or unavailable.
  - [ ] Sentinel model, effort, prompt, error, and adapter data never occur in JSONL output.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every outcome reflects provider-confirmed options.
- Telemetry remains local, opt-in, and content-free.
