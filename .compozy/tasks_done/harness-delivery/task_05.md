---
status: completed
title: "Add Degraded-Start Recovery UI Without Content Leakage"
type: frontend
complexity: high
---

# Task 05: Add Degraded-Start Recovery UI Without Content Leakage

## Overview

Expose the fixed failed-delivery result as a concise, keyboard-accessible recovery state while keeping successful conversations silent. The UI must direct the focused user to a safe fresh conversation, preserve their original task through the existing action seam, and never reveal hidden harness or provider details.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add a protocol-free fixed-field delivery notice projection with no harness text, original task text, profile ID, version, path, raw error, or ACP detail.
2. MUST store and select the notice narrowly per `SessionId`, preserving sibling structural sharing and clearing it after safe replacement.
3. MUST render no routine success badge for `pending`, `delivered`, or `not_required`; see PRD "User Experience" and ADR-002.
4. MUST render concise actionable failure copy and make the existing `/new` safe-fresh action keyboard discoverable for the focused failed conversation.
5. MUST retain the original failed-send draft/task until it is sent through the new fresh generation, never through the failed generation.
6. MUST consume the fixed projection from tasks_03 and _04 without becoming a delivery-state authority or changing persistence schema.
</requirements>

## Subtasks

- [ ] 5.1 Define the fixed content-free UI notice projection.
- [ ] 5.2 Add narrow store ownership and selector access per session.
- [ ] 5.3 Render a silent normal path and concise failed-start recovery state.
- [ ] 5.4 Make safe fresh recovery accessible through the existing focused-session command.
- [ ] 5.5 Clear recovery state only after successful replacement.
- [ ] 5.6 Add store, rendering, keyboard, and non-leak regression coverage.

## Implementation Details

Use TechSpec "System Architecture", "Monitoring and Observability", and "PRD Requirement Mapping". Reuse the existing unavailable-restoration and fresh-session action patterns instead of adding a new recovery transport. The UI handles only fixed state and the recovery affordance; it does not render or retain hidden content.

### Relevant Files

- `src/core/types.ts` — protocol-free fixed-field `HarnessDeliveryNotice` shape.
- `src/store/appStore.ts` — per-session ephemeral notice ownership, clearing, and structural sharing.
- `src/store/selectors.ts` — narrow focused-session notice selector.
- `src/ui/ConversationView.tsx` — concise failure callout and accessible recovery affordance.
- `src/ui/CockpitApp.tsx` — routes the existing `/new` command to degraded-start recovery for the focused session.
- `src/store/appStore.test.ts` — isolation, idempotency, and clearing behavior.
- `src/ui/ConversationView.test.tsx` — real shell rendering and keyboard recovery behavior.

### Dependent Files

- `src/app/controller.ts` — task_03 publishes only a derived fixed notice and task_04 restores it conservatively.
- `src/app/actions.ts` — remains the sole UI-to-controller safe-fresh recovery seam.
- `src/ui/PromptEditor.tsx` — retains failed-send draft behavior and must not gain harness handling.
- `src/persistence/runRecord.ts` — task_04 owns schema and must not be changed here.

### Related ADRs

- [ADR-001: Scope harness delivery by live ACP session generation](adrs/adr-001.md) — fail closed and content-free recovery boundary.
- [ADR-002: Keep baseline guidance silent by default and recovery-oriented on failure](adrs/adr-002.md) — silent success and actionable recovery UX.
- [ADR-003: Own delivery state by controller generation and persist only a content-free checkpoint](adrs/adr-003.md) — UI consumes derived notice and is not delivery authority.

## Deliverables

- Per-session content-free degraded-start notice and narrow selector.
- Keyboard-accessible safe fresh recovery with preserved original task.
- Silent rendering for healthy delivery states.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for focused recovery and content non-leakage **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] A failed notice for Claude changes only Claude's notice projection while Codex and unrelated state retain identity.
  - [ ] Notice input accepts only fixed fields and rejects harness text, original task text, profile/version detail, paths, and raw errors.
  - [ ] Pending, delivered, and `not_required` render no routine badge or recovery affordance.
  - [ ] Successful safe replacement clears the focused notice and restores quiet normal rendering.
- Integration tests:
  - [ ] A fixed failed notice renders concise actionable copy and keyboard-only `/new` invokes fresh recovery for the focused session.
  - [ ] The preserved original task is dispatched only through the replacement generation and never into the failed one.
  - [ ] Conversation rendering, prompt history, and recovery copy never contain synthetic harness content.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Healthy conversations remain silent and failed fresh starts have one clear recovery route.
- UI state, rendered text, and recovery behavior contain no hidden harness or provider payload.
