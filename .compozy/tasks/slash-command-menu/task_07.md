---
status: completed
title: "PromptEditor menu integration"
type: frontend
complexity: high
dependencies:
  - task_03
  - task_04
  - task_05
  - task_06
---

# Task 07: PromptEditor menu integration

## Overview
Wire the slash menu into the prompt editor: detect the `/` token as the user types, arm and disarm a non-modal menu, capture its navigation keys, and on selection either run a cockpit action or insert an agent command's text.
This is the integration hub that makes the feature usable, and it carries the interaction, trigger-edge-case, and render-count tests.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST arm the menu only when `/` begins the token under the caret (start of input or after whitespace/newline) and disarm on no-match, a second `/` in the token, or the caret leaving the token, per ADR-001 and the TechSpec.
- MUST, while armed, capture the menu navigation keys in `onKeyDown` (via `matchMenuCommand`, with `preventDefault`); when disarmed, Enter MUST submit the prompt normally.
- MUST render `SlashMenu` with cockpit rows built from the menu-relevant `COCKPIT_KEYMAP` entries and agent rows from `selectSessionCommands(focusedSessionId)`, grouped by source (Cockpit first), filtered by the token.
- MUST invoke a cockpit selection through `onRunCommand(command)` and an agent selection by replacing the token with `"/name "` (cursor after) then closing the menu; MUST NOT call `sendPrompt` or otherwise reach an agent on any selection.
- MUST keep the menu non-modal (the textarea stays focused; the menu is not a store overlay) and MUST NOT re-render the transcript on menu keystrokes.
</requirements>

## Subtasks
- [x] 7.1 Detect the `/` token from the buffer/caret in `onContentChange` and drive arm/disarm state.
- [x] 7.2 Capture the menu navigation keys in `onKeyDown` while armed; fall through when disarmed.
- [x] 7.3 Assemble grouped, filtered rows from the keymap and the commands selector.
- [x] 7.4 Run a cockpit selection via `onRunCommand`; insert an agent command's text via the textarea.
- [x] 7.5 Render `SlashMenu` anchored above the textarea without entering the store overlay slot.
- [x] 7.6 Add interaction, trigger-edge-case, and transcript render-count tests.

## Implementation Details
Token detection reads `plainText` + `cursorOffset` in `onContentChange`; navigation keys are intercepted in `onKeyDown` before the submit binding acts; agent-command insertion uses the textarea's `insertText`.
The menu deliberately stays out of `selectHasOpenOverlay`, so `focused={!overlayOpen}` is unaffected and the editor keeps focus.
See the TechSpec "System Architecture" data-flow and "Implementation Design"; consume task_03 (selector), task_04 (`matchMenuCommand`/keymap), task_05 (`onRunCommand`), and task_06 (`SlashMenu`).

### Relevant Files
- `src/ui/PromptEditor.tsx` - owns the textarea, `onContentChange`, `onKeyDown`, `submit`, and the focused-session reads.
- `src/ui/SlashMenu.tsx` - the presentational menu (task_06) rendered here.
- `src/ui/keymap.ts` - `COCKPIT_KEYMAP` (row source) and `matchMenuCommand` (task_04).
- `src/store/selectors.ts` - `selectSessionCommands` (task_03) and `selectFocusedSessionId`.
- `src/ui/PromptEditor.test.tsx` - existing `testRender` + `mockInput` harness to extend.

### Dependent Files
- `src/ui/CockpitApp.tsx` - supplies the `onRunCommand` prop (task_05).
- `test/fakeController.ts` - seeds the focused session's `commands` for interaction tests.

### Related ADRs
- [ADR-001: Command menu V1 scope, trigger model, and state ownership](../adrs/adr-001.md) - token-begin trigger, invoke-not-send, non-modal.
- [ADR-004: Non-modal editor-local menu with a shared cockpit-command dispatcher](../adrs/adr-004.md) - editor-local state and the `onRunCommand` callback.

## Deliverables
- Menu state, token detection, key capture, and selection handling in `PromptEditor`, rendering `SlashMenu`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests covering open/filter/select/dismiss, trigger edge cases, and the render-count guard **(REQUIRED)**

## Tests
- Unit tests:
  - [x] The token detector arms for `/` at input start and for `/` after whitespace (`foo /`), and does not arm for a mid-word slash (`foo/bar`).
  - [x] The detector disarms when the token has no matching command (`/xyz`) and when a second `/` is typed (`/usr/`).
- Integration tests:
  - [x] Typing `/` opens the menu with the Cockpit group first (hand-off on top) and the seeded agent group below.
  - [x] Typing `/rev` narrows to and highlights the `/review` row.
  - [x] Enter on the hand-off row calls `onRunCommand("hand-off")` and records no `sendPrompt`.
  - [x] Enter on `/review` sets the buffer to `"/review "` with the cursor after it, closes the menu, and records no `sendPrompt`.
  - [x] Esc disarms without clearing the typed text, and a subsequent Enter submits via `sendPrompt`.
  - [x] Typing `/usr/bin` never arms the menu and Enter submits it as a literal prompt.
  - [x] The transcript view does not re-render while navigating the armed menu (stable render count).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- No menu selection ever calls `sendPrompt` (invoke-not-send holds).
- The menu is non-modal (`overlayOpen` stays false) and the transcript render count is stable across menu keystrokes.
