---
status: pending
title: "Add Delegated Parent Close Confirmation"
type: frontend
complexity: medium
---

# Task 7: Add Delegated Parent Close Confirmation

## Overview

Extend the existing captured-target close dialog for a parent with active delegated children. The user must see the affected count and text statuses, then either cancel those children and close or keep working; no background or detach choice is allowed in this condition.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST reuse the existing `TabDialog` captured target and `closeConversation(parentId, "cancel")` action boundary.
2. MUST show `Cancel N child tasks and close` and `Keep working` only when the captured parent has non-terminal owned children.
3. MUST display affected count and explicit delegated status labels, update while the dialog is open, and omit Background or detach choices.
4. MUST keep focus on the captured parent when opening from a background or nonfocused source and preserve existing modal key consumption and priority behavior.
5. MUST return to ordinary close policy when all owned children are terminal.
</requirements>

## Subtasks

- [ ] 7.1 Add a narrow selector for a captured parent’s active-child close summary.
- [ ] 7.2 Render the special two-choice close dialog and explanatory status text.
- [ ] 7.3 Route confirmation and keep-working choices through existing parent actions only.
- [ ] 7.4 Preserve captured-target, dynamic summary, and modal-priority behavior.
- [ ] 7.5 Add delegated-parent close regression coverage.

## Implementation Details

Follow the TechSpec **Data Flow** and parent-close contract. The controller owns cascade semantics and child teardown; this task only presents the store-derived summary and delegates one parent action.

### Relevant Files

- `src/ui/TabDialog.tsx` — owns captured-target close choices, copy, navigation, and key consumption.
- `src/ui/TabDialog.test.tsx` — owns close dialog, captured target, choice, and modal-priority tests.
- `src/store/selectors.ts` — exposes a compact active-child close summary for the captured parent.

### Dependent Files

- `src/app/actions.ts` — retains the existing parent `closeConversation` UI boundary.
- `src/app/controller.ts` — interprets confirmed parent cancellation as an idempotent cascade.
- `src/ui/keymap.ts` — retains existing dialog navigation and escape semantics without a new binding.
- `src/ui/CockpitApp.tsx` — retains existing dialog mount and higher-priority approval/clarification behavior.

### Related ADRs

- [ADR-001: Use a flat, host-owned delegation registry for V1](adrs/adr-001.md) — forbids implicit detachment.
- [ADR-002: Prioritize fast, explicit child launch in the MVP](adrs/adr-002.md) — requires clear affected-work disclosure.
- [ADR-003: Keep delegation state protocol-free and ephemeral in AppState](adrs/adr-003.md) — requires store-derived close state.
- [ADR-004: Derive delegation completion from store selectors in V1](adrs/adr-004.md) — requires selector-derived group summary.

## Deliverables

- Store-derived delegated-parent close summary and special confirmation path.
- Clear cancel-and-close versus keep-working behavior with no detach option.
- Captured-target and live-status UI regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for parent close confirmation **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] A parent with Running and Needs input children shows the exact count and both text labels without Background.
  - [ ] Enter on the default special choice calls `closeConversation(parentId, "cancel")` once and never issues child-level UI cancellations.
  - [ ] Keep working and Escape preserve all parent/child lifecycle state and use only the parent keep-open action.
  - [ ] A parent with terminal-only children shows ordinary close choices instead of the special warning.
  - [ ] Child status changes while the dialog is open update summary copy while keeping navigation clamped.
- Integration tests:
  - [ ] Closing a background/nonfocused parent from `/sessions` retains its captured target and does not switch focus before confirmation.
  - [ ] Printable text, tab chords, and shell bytes remain blocked while the special confirmation is open; approval takes precedence.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- A close confirmation never presents a detach path for active delegated children.
- UI cancellation remains parent-scoped and delegates all lifecycle authority to the controller.
