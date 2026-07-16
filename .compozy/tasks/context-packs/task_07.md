---
status: pending
title: Controller-owned Context Build lifecycle
type: backend
complexity: high
---

# Task 07: Controller-owned Context Build lifecycle

## Overview

Add the controller and action lifecycle that explicitly starts one eligible Context Build, atomically binds it to an addressed draft, and cleans it up without focus changes or implicit consequential actions.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- startContextBuild MUST be exposed through ControllerActions and return a typed, fail-soft result rather than throwing or silently falling back to explore-v1.
- The controller MUST re-attest explore-v2, verify parent generation and workspace, and allow at most one active build for an addressed draft.
- The store MUST create/refine and bind the exact draft revision before the async child launch begins.
- The child MUST use the verified exact recipe and dedicated bridge; it MUST not receive parent authority or a broad action facade.
- Terminal cleanup MUST match parent/child/generation, release only that binding, preserve focus/overlays, and leave review readiness as attention only.
</requirements>

## Subtasks

- [ ] 7.1 Add the typed Context Build action and availability result.
- [ ] 7.2 Preflight exact evidence, parent generation, workspace, and exclusivity.
- [ ] 7.3 Atomically prepare and bind the draft before spawning one child.
- [ ] 7.4 Register the dedicated bridge and settle the matching lifecycle.
- [ ] 7.5 Add launch race, cleanup, and focus-preservation coverage.

## Implementation Details

Follow the TechSpec ControllerActions and delegation lifecycle. The action/controller layer owns ACP/runtime I/O; AppStore remains the only mutable state owner.

### Relevant Files

- src/app/actions.ts — ControllerActions start surface and typed response.
- src/app/actions.test.ts — action availability and denial coverage.
- src/app/controller.ts — preflight, atomic binding, launch, and cleanup owner.
- src/app/controller.test.ts — lifecycle and concurrency coverage.
- src/store/appStore.ts — existing atomic binding transitions.
- src/app/contextPackBridge.ts — dedicated child route registration.

### Dependent Files

- src/config/contextPackCapability.ts — exact build eligibility evidence.
- src/core/contextPack.ts — fresh/refine and typed lifecycle values.
- src/store/selectors.ts — later presentation projections.
- src/ui/ContextPackPanel.tsx — later build action caller.

### Related ADRs

- [ADR-004: Use a separate generation-bound Context Pack bridge for explore-v2](adrs/adr-004.md)
- [ADR-001: Plan the full Context Packs contract with evidence-gated vertical delivery](adrs/adr-001.md)
- [ADR-002: Launch Context Packs as a verified-provider pilot for trusted focused handoffs](adrs/adr-002.md)

## Deliverables

- Typed startContextBuild action and controller lifecycle.
- Atomic one-build binding with exact child/parent generation ownership.
- Fail-soft availability and cleanup behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for lifecycle races with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Missing or stale explore-v2 evidence returns an explicit denial and starts no child.
  - [ ] A build binds the addressed draft revision before child launch and denies a concurrent second build.
  - [ ] Parent-generation, workspace, and session mismatch deny before bridge registration.
  - [ ] Child failure, parent close, and matching settlement release only the matching binding.
- Integration tests:
  - [ ] A background Context Build completing for session B leaves selectedVisibleId, focus, and overlays for session A unchanged.
  - [ ] Stale async cleanup cannot release a newer binding for the same session.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- One verified Context Build is bound to one exact draft and generation.
- Denials and terminal events are explicit, isolated, and do not steal focus or trigger review/sealing/delivery.
