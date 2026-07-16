---
status: completed
title: Add explore availability and typed denial handling to the delegation dialog
type: frontend
complexity: high
---

# Task 04: Add explore availability and typed denial handling to the delegation dialog

## Overview

Make the existing delegation dialog communicate the fixed `explore` contract before an operator confirms work. The dialog must show advisory availability and readable restrictions, call only the shared explore action, and retain drafts with a specific safe denial when launch-time validation refuses the request.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST present the fixed `explore` label and textual restrictions before confirmation: read-only filesystem, no shell, no external MCP or agent control, scoped `ask_user`, and no recursion.
- MUST render advisory availability and fixed plain-language typed-denial copy without raw provider/configuration/error/task content.
- MUST call only `startExploreChild` with trimmed task and desired outcome values; no unrestricted or warning-only action may be reachable from the dialog.
- MUST keep the dialog open, clear pending state, retain task/outcome drafts and focus, and replace advisory status when a launch-time denial or startup failure is returned.
- MUST close the dialog only after a started result, preserve current validation/Escape/repeated-confirm behavior, and preserve approval/clarification preemption semantics.
- MUST source availability and copy through narrow selector/controller projections, never by deriving policy from UI configuration.
</requirements>

## Subtasks
- [x] 4.1 Add narrow explore availability and denial projections for the captured parent.
- [x] 4.2 Update the dialog to describe the fixed explore contract before confirmation.
- [x] 4.3 Replace generic failure handling with typed safe-denial presentation.
- [x] 4.4 Preserve local draft, focus, pending, validation, and overlay ownership behavior.
- [x] 4.5 Extend test fakes and selector/dialog coverage for accepted and refused results.

## Implementation Details

Follow TechSpec sections “Data Flow,” “Requirements Traceability,” and “Testing Approach.” Consume immutable policy/decision values from upstream state and controller results; do not recreate attestation, capacity, MCP, or restriction logic in the UI.

### Relevant Files
- `src/ui/DelegationDialog.tsx` — current local task/outcome drafts, pending state, modal ownership, and generic child-start failure.
- `src/ui/DelegationDialog.test.tsx` — current validation, Escape, repeat-confirm, and preemption test harness.
- `src/store/selectors.ts` — narrow selector and cache boundary for parent availability and child presentation.
- `src/store/selectors.test.ts` — reference-stability and projection tests.
- `test/fakeController.ts` — TUI fake must expose the typed explore action/availability seam.

### Dependent Files
- `src/app/actions.ts` — supplies the typed explore launch result consumed by the dialog.
- `src/app/controller.ts` — authoritative typed availability and launch decision owner.
- `src/core/explorePolicy.ts` — upstream closed restriction and denial vocabulary.
- `src/ui/CockpitApp.tsx` — existing modal mount order must remain unchanged.

### Related ADRs
- [ADR-002: Make Verified Safe Delegation the Operator Product Contract](adrs/adr-002.md) — requires clear refusal with no unsafe fallback.
- [ADR-003: Resolve Explore Policy in Core and Snapshot It on Registration](adrs/adr-003.md) — requires selector consumption of immutable policy facts.
- [ADR-006: Verify the Explore Contract Through Layered Tests](adrs/adr-006.md) — requires accessible UI evidence.

## Deliverables

- Delegation dialog availability and restriction summary for the fixed explore role.
- Typed denial UI that preserves drafts and never exposes raw runtime details.
- Narrow selector/fake-controller support with stable projection behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for dialog launch results and modal behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Each closed availability/denial reason maps to fixed content-free text and selector output remains referentially stable across unrelated session updates.
  - [x] Policy projection changes rebuild the cached view while token-stream and unrelated-session updates retain the same reference.
  - [x] Restriction summary contains every allowed/prohibited V1 capability and does not depend on color-only status.
- Integration tests:
  - [x] Eligible dialog submission calls only `startExploreChild` with trimmed task/outcome and closes only after a started result.
  - [x] Unavailable-before-submit state prevents a launch and presents the exact safe reason without an unrestricted bypass.
  - [x] Launch-time typed denial and startup failure clear pending state, retain dialog drafts/focus, and replace advisory text with the returned fixed reason.
  - [x] Repeated Enter produces one request; existing validation, Escape, approval/clarification preemption, and resumed drafts remain correct.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Operators can distinguish eligible, unavailable, and denied explore states without raw or color-only information.
- The dialog has no route to start an unrestricted fallback child.
