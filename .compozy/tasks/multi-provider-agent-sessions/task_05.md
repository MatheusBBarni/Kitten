---
status: pending
title: "Ctrl+S sessions overview and jump-to-next"
type: frontend
complexity: high
dependencies:
  - task_03
  - task_04
---

# Task 05: Ctrl+S sessions overview and jump-to-next

## Overview
Add the Ctrl+S sessions overview: a modal, keyboard-driven list of every session with its title, provider, directory, and state, that calls out which sessions need the developer and jumps focus to the next one that does.
It reuses the existing overlay modality and selection pattern so it behaves consistently with the approval and hand-off overlays.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a `sessions` overlay slot to `OverlayState` with open/close store actions, and include it in `selectHasOpenOverlay`, per the TechSpec "Actions and Events" section.
- MUST add a `Ctrl+S` command to the cockpit keymap and a `SESSIONS_KEYMAP` (up/down to move, Enter to jump into the highlighted session, a key to jump to the next needs-you session, Esc to dismiss), with matching help and hint entries.
- MUST render one selectable card per session showing title, provider, working directory, and state (from `selectSessionList`), with needs-you sessions visually called out, reusing the marker-highlight and arrow-clamp pattern of the existing overlays.
- MUST add a `jumpToNextNeedy` action that sets focus to `selectNextNeedy(focusedSessionId)`.
- MUST be modal like the approval and hand-off overlays: swallow keys while open, stand the shell's chords down, and restore prompt focus on close.
</requirements>

## Subtasks
- [ ] 5.1 Add the `sessions` overlay slot, its open/close actions, and its inclusion in `selectHasOpenOverlay`.
- [ ] 5.2 Add the `Ctrl+S` command, `SESSIONS_KEYMAP`, help rows, and the strip hint.
- [ ] 5.3 Build the `SessionsOverlay` card list from `selectSessionList`, calling out needs-you sessions.
- [ ] 5.4 Add the `jumpToNextNeedy` action wired to `selectNextNeedy`.
- [ ] 5.5 Mount the overlay in the cockpit shell and gate the shell's keys while it is open.

## Implementation Details
Model the overlay on `ApprovalPrompt`/`HandoffPreview` per the TechSpec "Sessions overview" note: a store slot, a `selectHasOpenOverlay` gate, its own `useKeyboard` that `preventDefault`s, and the shared selection pattern.
The keymap table stays the single source of truth for dispatch and the help panel.

### Relevant Files
- `src/ui/SessionsOverlay.tsx` - new overlay component and its selection state.
- `src/store/appStore.ts` - the `sessions` overlay slot and its actions.
- `src/store/selectors.ts` - the overlay selector and the updated `selectHasOpenOverlay`.
- `src/ui/keymap.ts` - the `Ctrl+S` command, `SESSIONS_KEYMAP`, help, and hint.
- `src/ui/CockpitApp.tsx` - mounting the overlay and standing the shell down.
- `src/app/actions.ts` - the `jumpToNextNeedy` action.

### Dependent Files
- `src/app/handoff.ts` - task_06 reuses the overview selection as the hand-off target picker.

### Related ADRs
- [ADR-006: Attention State Model and Jump-to-Next](../adrs/adr-006.md) - the needs-you signal and jump ordering the overview surfaces.
- [ADR-001: N-Session Model, Overview Stays Thin](../adrs/adr-001.md) - the overview is deliberately a thin router, not a fleet manager.

## Deliverables
- A modal `Ctrl+S` sessions overview rendering every session's state.
- A `jumpToNextNeedy` action and its keybinding.
- Keymap, help, and hint entries for the new command.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests driving the overlay through the test renderer **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] `Ctrl+S` maps to the `sessions` command and `SESSIONS_KEYMAP` maps up/down, Enter, the jump key, and Esc.
  - [ ] Opening the sessions overlay makes `selectHasOpenOverlay` return true.
  - [ ] `jumpToNextNeedy` sets focus to the session returned by `selectNextNeedy`.
  - [ ] The card list renders one entry per session in `order` with its title, provider, directory, and state.
- Integration tests:
  - [ ] With three sessions where one is `awaiting_approval`, open Ctrl+S in the test renderer, assert the cards render each state, Enter on a highlighted card focuses that session, the jump key lands on the `awaiting_approval` session, and Esc restores prior focus and returns the keyboard to the prompt.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The overview is modal and keyboard-consistent with the existing overlays
- Jump-to-next lands on the highest-priority needs-you session
