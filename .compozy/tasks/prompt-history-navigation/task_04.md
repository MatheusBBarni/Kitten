---
status: pending
title: "Implement Composer Recall UX and Keyboard Help"
type: frontend
complexity: high
---

# Task 4: Implement Composer Recall UX and Keyboard Help

## Overview

Deliver the keyboard-first prompt-recall experience in the real multiline composer. The UI must preserve native vertical editing and slash-menu navigation, show a concise history position while browsing, and use the controller actions rather than touching session state directly.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST record an accepted nonblank composer submission through `ControllerActions` before invoking the existing agent send action.
2. MUST keep armed slash-menu Up and Down behavior unchanged.
3. MUST handle only unmodified vertical arrows and preserve native textarea movement whenever the installed editor reports movement.
4. MUST request history only after native movement reports an editor boundary and replace textarea text only when the action returns a non-null result.
5. MUST show a compact `History n/total` indicator only while recall is active and remove it after the newest entry clears.
6. MUST document the recall and multiline-boundary behavior in editor keyboard help without adding a global Up or Down binding.
</requirements>

## Subtasks

- [ ] 4.1 Connect composer submission and boundary navigation to the controller actions from task 3.
- [ ] 4.2 Preserve slash-menu precedence and native multiline cursor movement for all non-history arrow behavior.
- [ ] 4.3 Render and clear the session-derived history indicator in the prompt surface.
- [ ] 4.4 Update editor keyboard guidance without changing global shortcut ownership.
- [ ] 4.5 Add real-textarea regressions for history, multiline boundaries, menu precedence, and session isolation.

## Implementation Details

Follow the TechSpec’s **PromptEditor Dispatch**, **Testing Approach**, and **Impact Analysis** sections. Use the installed textarea movement result as the boundary authority; do not recreate wrapped-line calculations or introduce a UI-local history cache.

### Relevant Files

- `src/ui/PromptEditor.tsx` — sole prompt-composition surface, textarea ref owner, slash-menu dispatcher, and submit path.
- `src/ui/PromptEditor.test.tsx` — mounts the real textarea with Kitty keyboard support and the fake controller.
- `src/ui/keymap.ts` — single source of truth for editor help copy and existing menu ownership.
- `src/ui/keymap.test.ts` — ensures help entries and menu bindings do not drift.

### Dependent Files

- `src/store/selectors.ts` — provides the narrow session history slice used for the indicator.
- `src/app/actions.ts` — provides composer record/navigation actions.
- `test/fakeController.ts` — supplies the mounted view’s action contract and real store behavior.

### Related ADRs

- [ADR-001: Scope Prompt Recall to the Active Agent Session](adrs/adr-001.md) — requires current-run isolation and clear-after-newest behavior.
- [ADR-002: Make Prompt Recall Visible and Collapse Adjacent Duplicates](adrs/adr-002.md) — requires visible recall state and concise history.
- [ADR-004: Gate Recall with OpenTUI Cursor-Movement Results](adrs/adr-004.md) — requires native movement and menu precedence before history navigation.

## Deliverables

- Boundary-aware prompt recall and history indicator in the real composer.
- Updated editor help copy with no global arrow binding.
- Mounted editor and keymap regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for composer recall behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Editor help lists Up/Down recall behavior without adding a global cockpit command binding.
  - [ ] Modified arrows remain outside the recall path.
  - [ ] A non-null history result replaces the full textarea text, while a null result leaves it unchanged.
- Integration tests:
  - [ ] After submitting two prompts, Up recalls the newest then the older prompt; Down returns toward newest and clears only after it.
  - [ ] `History n/total` appears while browsing and disappears after clear-after-newest.
  - [ ] An armed slash menu continues to move its highlighted command with Up/Down and does not recall a prompt.
  - [ ] Multiline or wrapped text with available vertical movement moves the cursor without replacing prompt text; a true boundary enters history.
  - [ ] Switching focus between sessions shows only the owning session’s history and never exposes another session’s prompts.
  - [ ] Consecutive duplicate submissions produce one recallable entry and do not change the indicator total twice.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Up and Down preserve menu and multiline editing precedence while enabling boundary recall.
- The indicator is accurate, session-local, and absent outside active recall.
