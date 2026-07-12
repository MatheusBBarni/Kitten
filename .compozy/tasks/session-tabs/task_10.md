---
status: pending
title: "Guard selected-only workspace controls"
type: frontend
complexity: medium
---

# Task 10: Guard selected-only workspace controls

## Overview

Make composer, status, and model controls safe and understandable when no Visible conversation is selected. An empty or background-only workspace must never route an action to a stale, first, or fabricated SessionId.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST disable prompt submission and cancellation when no selected Visible conversation exists without consulting session-bound runtime or selector APIs.
2. MUST render workspace/background summary information in the status strip instead of stale model, effort, or session status data.
3. MUST suppress model-selection entry points and overlays when selection is null.
4. MUST retain all current selected-session behavior unchanged when a real Visible conversation is selected.
5. MUST never substitute a background, Closed, first configured, or sentinel ID for null selection.
</requirements>

## Subtasks
- [ ] 10.1 Gate composer submission and cancellation on real workspace selection.
- [ ] 10.2 Present empty-workspace and background-work status safely.
- [ ] 10.3 Gate model controls and related shortcuts on real selection.
- [ ] 10.4 Preserve selected-session controls and feedback.
- [ ] 10.5 Verify no selected-only API receives a fabricated identifier.

## Implementation Details

Apply the TechSpec’s **Focus Authority and Empty Workspace** section. The action layer already owns fail-safe semantics; this task ensures controls communicate and enforce that boundary consistently.

### Relevant Files
- `src/ui/PromptEditor.tsx` — prompt, cancel, readiness, command, and disabled-state behavior.
- `src/ui/PromptEditor.test.tsx` — selected and no-selection composer scenarios.
- `src/ui/StatusStrip.tsx` — selected-session metadata and workspace/background summary surface.
- `src/ui/StatusStrip.test.tsx` — status content and non-color presentation tests.
- `src/ui/ModelSelect.tsx` — selected-session model interaction and overlay trigger.
- `src/ui/ModelSelect.test.tsx` — null-selection guard and selected-session regression coverage.

### Dependent Files
- `src/ui/CockpitApp.tsx` — decides selected workspace/empty state and command routing.
- `src/ui/ConversationView.tsx` — provides selected-conversation content only when valid.
- `src/app/actions.ts` — fail-soft prompt, cancel, and model action boundary.
- `src/store/selectors.ts` — nullable focus and workspace summary selectors.
- `src/app/handoff.ts` — related selected-source safety already guarded at the action layer.
- `src/ui/EmptyWorkspace.tsx` — primary new-conversation and background-work surface.

### Related ADRs
- [ADR-002: Prioritize a Restorable, Fast-Switching Conversation Tab Workspace](adrs/adr-002.md) — requires an operable empty workspace after final visible-tab removal.
- [ADR-004: Separate Workspace Metadata from Session State and Persist a Versioned Workspace](adrs/adr-004.md) — makes nullable selection a valid persisted/workspace condition.

## Deliverables
- Null-safe prompt, status, and model controls with clear workspace feedback.
- Regression coverage for selected sessions and empty/background-only workspaces.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests covering mounted control behavior without a selected session **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] No selected session disables prompt/cancel and invokes no runtime, readiness, command, or action call.
  - [ ] Status strip reports workspace/background state without stale model, effort, or turn status.
  - [ ] Model commands and entry points leave their overlay closed when selection is null.
  - [ ] Existing prompt, whitespace, Escape-cancel, model, and selected-session status behavior remains unchanged.
- Integration tests:
  - [ ] A background-only/empty cockpit frame is stable, has no selected-only overlay, and cannot submit or target a stale session.
  - [ ] Restoring a visible conversation re-enables controls only for that selected SessionId.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing.
- Test coverage >=80%.
- Empty workspace controls cannot emit agent effects.
- Selected-session controls remain fully functional with a real visible target.
