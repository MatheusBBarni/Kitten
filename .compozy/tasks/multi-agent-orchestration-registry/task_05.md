---
status: completed
title: "Build the Explicit Delegation Launch Dialog"
type: frontend
complexity: medium
---

# Task 5: Build the Explicit Delegation Launch Dialog

## Overview

Add the fast, explicit launch surface for a focused parent conversation. The modal captures a child task and desired outcome, invokes the controller action once, and keeps the parent selected while the child begins in the background.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST open from `Ctrl+G` and `/delegate` only when a focused parent exists; bare `g` MUST remain prompt input.
2. MUST retain only the captured parent id in store overlay state and keep task/outcome drafts exclusively in component state.
3. MUST require non-empty trimmed task and desired outcome values, show field-specific validation, and invoke launch exactly once for a pending submission.
4. MUST close only after a non-null child id, keep local feedback visible after a fail-soft result, and never select the child.
5. MUST participate in existing modal priority and global-key suppression, including approval/clarification preemption and Escape cancellation.
</requirements>

## Subtasks

- [ ] 5.1 Add a captured-parent delegation modal slot and selector to existing overlay state.
- [ ] 5.2 Register the Ctrl+G and `/delegate` command in the canonical keymap/help surface.
- [ ] 5.3 Create the task/outcome modal with validation, pending state, and local failure feedback.
- [ ] 5.4 Mount the dialog in the cockpit overlay hierarchy and dispatch the focused parent action.
- [ ] 5.5 Add modal, keymap, focus-retention, and preemption coverage.

## Implementation Details

Follow the TechSpec **Data Flow** and **API Endpoints** sections. Reuse the modal/input behavior of existing clarification, handoff, and tab dialogs; do not implement child runtime creation, workspace status rendering, close policy, telemetry, or persistence here.

### Relevant Files

- `src/ui/DelegationDialog.tsx` — new local-draft task/outcome modal.
- `src/ui/DelegationDialog.test.tsx` — new mounted-cockpit dialog coverage.
- `src/ui/CockpitApp.tsx` — opens and mounts the modal through existing overlay flow.
- `src/ui/keymap.ts` — owns Ctrl+G, `/delegate`, help text, and modal key routing.
- `src/ui/keymap.test.ts` — verifies command mapping, uniqueness, and printable-key pass-through.
- `src/store/appStore.ts` — owns captured-parent overlay slot and open/close actions.
- `src/store/selectors.ts` — exposes the dialog selector and global modal precedence.

### Dependent Files

- `src/app/actions.ts` — supplies `ControllerActions.startDelegatedChild`.
- `test/fakeController.ts` — records deterministic launch calls for UI tests.
- `src/ui/TabWorkspace.tsx` — renders the resulting child Running state in a later task.

### Related ADRs

- [ADR-002: Prioritize fast, explicit child launch in the MVP](adrs/adr-002.md) — defines the primary launch experience.
- [ADR-003: Keep delegation state protocol-free and ephemeral in AppState](adrs/adr-003.md) — constrains captured store state.

## Deliverables

- Delegation dialog, canonical command binding, and overlay-state integration.
- Focus-retaining success and fail-soft launch UX.
- Dialog and keymap regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for the focused-parent launch flow **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Ctrl+G maps to delegation while bare `g` stays composer input and command/help entries remain unique.
  - [ ] Whitespace-only task or outcome shows a field error and records no action call.
  - [ ] Valid submit passes trimmed values and the captured parent id exactly once during a pending request.
  - [ ] A null launch result keeps the dialog open with visible local feedback.
  - [ ] Escape cancels without launching and restored focus remains in the parent composer.
- Integration tests:
  - [ ] Successful launch closes the modal while selected parent id and focused pane remain unchanged.
  - [ ] Approval or clarification takes key priority over the dialog without discarding local drafts.
  - [ ] Open dialog consumes printable text, shell chords, and unrelated global commands.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- A developer can submit one explicit child task/outcome without leaving the parent conversation.
- No draft content is stored, persisted, or emitted as telemetry by the dialog.
