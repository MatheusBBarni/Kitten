---
status: pending
title: /context workspace and review UI
type: frontend
complexity: high
---

# Task 11: /context workspace and review UI

## Overview

Add the session-addressed /context surface that lets an operator inspect a draft, exact review candidate, sealed pack, freshness, budget, eligibility, and bounded action states through selectors and ControllerActions only.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- /context MUST resolve only for the selected addressed session and MUST use narrow store selectors rather than local pack state.
- The surface MUST show draft/sealed phase, Pack Budget, freshness, fixed brief, selections, rationales, relationships, omissions, review bytes/redactions, and closed fit reasons.
- Build, review, seal, Send Here, refinement, and export controls MUST dispatch ControllerActions only and MUST show unavailable/blocked states without a bypass.
- The surface MUST have no global shortcut, filesystem access, bridge access, direct store mutation, or implicit recipient action.
- It MUST be keyboard-operable, non-color-only, and layered below Approval and Clarification without opening or preempting either.
</requirements>

## Subtasks

- [ ] 11.1 Add the Context Pack panel and selector-driven phase presentation.
- [ ] 11.2 Register /context in central slash-command, help, and focused-session routing.
- [ ] 11.3 Render review and sealed information with exact candidate/freshness/fit explanations.
- [ ] 11.4 Wire only the explicit ControllerActions and blocked states.
- [ ] 11.5 Add keyboard, overlay, session-switch, and action-dispatch coverage.

## Implementation Details

Follow the TechSpec UI command and overlay integration. This task creates the ContextPackPanel consumed by later File Explorer work; it does not implement repository discovery or attention state.

### Relevant Files

- src/ui/ContextPackPanel.tsx — new session-addressed Context Pack surface.
- src/ui/ContextPackPanel.test.tsx — panel, review, action, and accessibility coverage.
- src/ui/CockpitApp.tsx — focused-session surface composition.
- src/ui/CockpitApp.test.tsx — slash routing and overlay coverage.
- src/ui/keymap.ts — central slash command and help registration.
- src/ui/keymap.test.ts — command discoverability and no-global-chord coverage.
- test/fakeController.ts — panel ControllerActions test seam.

### Dependent Files

- src/store/selectors.ts — Context Pack and fit projections.
- src/app/actions.ts — explicit Context Pack action facade.
- src/app/controller.ts — exact review, seal, and consumption results.
- src/ui/ApprovalModal.tsx — existing higher-priority interaction layer.
- src/ui/ClarificationModal.tsx — existing higher-priority interaction layer.

### Related ADRs

- [ADR-001: Plan the full Context Packs contract with evidence-gated vertical delivery](adrs/adr-001.md)
- [ADR-002: Launch Context Packs as a verified-provider pilot for trusted focused handoffs](adrs/adr-002.md)
- [ADR-003: Keep Context Packs session-keyed and persist only manifests plus sealed bytes](adrs/adr-003.md)
- [ADR-005: Fail closed on Recipient Fit for every Context Pack consumption path](adrs/adr-005.md)

## Deliverables

- Accessible selected-session /context command and Context Pack panel.
- Exact review/sealed/freshness/budget/fit presentation and bounded controls.
- No global chord, focus theft, local mutable pack copy, or direct I/O.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for command routing and interaction layering with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] The panel renders each draft, review, sealed, unavailable, stale, and blocked state with textual labels.
  - [ ] The fixed brief, selections, rationales, relationships, omissions, candidate bytes, and redaction count display from selector output.
  - [ ] Buttons dispatch only the addressed ControllerActions and expose typed denials without changing local state.
  - [ ] Keyboard navigation provides visible focus and does not depend on color alone.
- Integration tests:
  - [ ] /context opens for the current session, session switching changes its projection, and no global chord opens it.
  - [ ] Existing Approval and Clarification overlays remain above it and retain their preemption behavior.
  - [ ] Opening the panel never starts review, sealing, sending, export, or a Context Build.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Operators can inspect exact Context Pack custody and eligibility through one focused, accessible surface.
- UI stays presentation-only and preserves existing approval/clarification priority.
