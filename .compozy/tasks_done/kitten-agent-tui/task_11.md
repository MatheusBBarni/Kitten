---
status: completed
title: "Approval prompt overlay"
type: frontend
complexity: medium
dependencies:
  - task_07
  - task_08
---

# Task 11: Approval prompt overlay

## Overview
Render the overlay that surfaces an agent's ACP permission request and lets the developer approve or reject a proposed action, returning the outcome to the agent.
This keeps the developer in control of what touches their code, which is a core PRD user story, and it must show enough of the pending action (title, kind, diff) to decide.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST render an overlay when the store's approval slot holds a pending permission request.
- MUST present the request's options (e.g. allow once, reject) and the pending action's title, kind, and diff when present.
- MUST return the selected outcome through the controller's `respondPermission` (task_07) and close the overlay.
- MUST render as a conditional, absolutely-positioned overlay (the React binding has no Portal), per ADR-004.
- MUST be keyboard-operable and clearly indicate which agent is requesting.
</requirements>

## Subtasks
- [x] 11.1 Render the overlay from the store's approval slot
- [x] 11.2 Present the request options and the pending action's title/kind/diff
- [x] 11.3 Return the chosen outcome via `respondPermission` and close the overlay
- [x] 11.4 Position the overlay as an absolute box above the cockpit
- [x] 11.5 Cover option selection and outcome routing with tests

## Implementation Details
Create the approval overlay. See TechSpec "System Architecture → UI Shell" (`ApprovalPrompt`) and Integration Points (ACP `requestPermission`). The overlay reads the approval slot populated by task_07 and calls `respondPermission`. Mounts over the shell from task_08.

### Relevant Files
- `src/ui/ApprovalPrompt.tsx` — new; the overlay
- `src/ui/ApprovalPrompt.test.tsx` — new; tests

### Dependent Files
- `src/ui/CockpitApp.tsx` (task_08) — mounts the overlay
- `src/app/actions.ts` (task_07) — `respondPermission` invoked here

### Related ADRs
- [ADR-004: React Binding for the OpenTUI UI Layer](adrs/adr-004.md) — overlay via absolute box, no Portal

## Deliverables
- Approval overlay wired to the permission flow
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test of a permission request resolving through the overlay **(REQUIRED)**

## Tests
- Unit tests:
  - [x] The overlay renders only when the approval slot holds a request, and is hidden otherwise
  - [x] The overlay shows the pending action's title, kind, and diff for an `edit` request
  - [x] Selecting "allow once" calls `respondPermission` with the allow outcome and closes the overlay
  - [x] Selecting "reject" calls `respondPermission` with the reject outcome and closes the overlay
- Integration tests:
  - [x] A mock connection's permission request opens the overlay and the chosen outcome is delivered back to the connection
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Permission requests surface a legible overlay and the outcome reaches the requesting agent
- The overlay is keyboard-operable and identifies the requesting agent
