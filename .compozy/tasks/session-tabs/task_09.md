---
status: pending
title: "Add rename and active-work close dialogs"
type: frontend
complexity: medium
---

# Task 09: Add rename and active-work close dialogs

## Overview

Provide a single modal slot for safe tab renaming and explicit active-work close decisions. The dialogs must retain the target SessionId, respect approval precedence, and ensure no tab-management action silently cancels work.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST model one mutually exclusive tab-dialog overlay with rename and active-close variants while including it in the aggregate overlay guard.
2. MUST prefill rename with the current display name, reject empty normalized input, and avoid any ACP/runtime effect for rename.
3. MUST offer direct idle close and explicit Background, Cancel deliberately, and Keep open choices for working or attention-bearing conversations.
4. MUST preserve the opening target SessionId and never infer dialog behavior from a later selected tab.
5. MUST make approvals topmost: tab dialogs must stand down fully while approval is pending and resume only safely afterward.
</requirements>

## Subtasks
- [ ] 9.1 Add discriminated tab-dialog state to the existing overlay model.
- [ ] 9.2 Render rename interaction with normalization, confirmation, and cancellation behavior.
- [ ] 9.3 Render status-aware close choices with stated consequences.
- [ ] 9.4 Preserve approval priority, keyboard ownership, and focus restoration.
- [ ] 9.5 Verify target identity and no-input-leak behavior across modal transitions.

## Implementation Details

Reference the TechSpec’s **Close Policy**, **Idempotent Teardown State Machine**, and **UI and Input Design** sections. Dialog components may call store and ControllerActions APIs only; connection and ACP work remain outside the UI.

### Relevant Files
- `src/store/appStore.ts` — tab-dialog overlay type, immutable open/replace/close operations.
- `src/store/appStore.test.ts` — structural sharing and overlay mutation coverage.
- `src/ui/TabDialog.tsx` — new rename and close-choice modal component.
- `src/ui/TabDialog.test.tsx` — new input, choice, Escape, and target-identity coverage.
- `src/ui/CockpitApp.tsx` — modal mounting order and global input suppression.
- `src/ui/CockpitApp.test.tsx` — approval precedence, focus, and shell suppression tests.

### Dependent Files
- `src/store/selectors.ts` — aggregate overlay guard and dialog selectors.
- `src/ui/ApprovalPrompt.tsx` — topmost approval ownership reference.
- `src/ui/ApprovalPrompt.test.tsx` — approval input/identity regression coverage.
- `src/app/actions.ts` — rename and close action boundary.
- `src/ui/SessionsOverlay.tsx` — later lifecycle entry points and focus restoration.
- `src/core/workspace.ts` — lifecycle and no-op semantics behind dialog choices.

### Related ADRs
- [ADR-001: Ship a Bounded, Attention-Safe Session-Tab Lifecycle](adrs/adr-001.md) — mandates explicit active-work close choices.
- [ADR-003: Use a Mutable Registry with One Dedicated Runtime per Conversation](adrs/adr-003.md) — assigns close/cancellation effects to the controller.

## Deliverables
- One discriminated tab-dialog overlay and UI component for rename/close interaction.
- Approval-safe keyboard, target-identity, and focus-restoration behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests covering modal precedence and active-work outcomes **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Rename pre-fills the current name, trims valid input, and refuses whitespace-only confirmation.
  - [ ] Idle close uses the direct close outcome; active statuses expose exactly Background, Cancel deliberately, and Keep open.
  - [ ] Keep open and Escape leave lifecycle/runtime state unchanged; Background has no ACP effect.
  - [ ] Dialog state is immutable, target-bound, mutually exclusive, and included in the open-overlay selector.
  - [ ] Approval over a tab dialog blocks tab-dialog input and retains the original dialog state safely.
- Integration tests:
  - [ ] A mounted dialog prevents prompt, shell, and global tab-key leakage until it closes.
  - [ ] A close choice affects the captured SessionId even if another tab becomes selected before confirmation.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing.
- Test coverage >=80%.
- Rename and close actions are explicit, target-bound, and approval-safe.
- No active conversation is cancelled by an ambiguous tab interaction.
