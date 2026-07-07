---
status: pending
title: "Prompt editor and send flow"
type: frontend
complexity: medium
dependencies:
  - task_07
  - task_08
---

# Task 10: Prompt editor and send flow

## Overview
Build the prompt editor where the developer composes and sends messages to the focused agent, following the keybinding conventions power users expect.
Submitting routes through the controller's `sendPrompt`, and interrupting a running agent routes through `cancel`.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST provide a multi-line prompt editor bound to the focused agent.
- MUST submit on Enter, insert a newline on Shift+Enter, and interrupt the running agent on Esc, per the PRD UX conventions.
- MUST route submission through the controller's `sendPrompt` and interruption through `cancel` (task_07).
- MUST handle bracketed paste, including large pastes, without corrupting the editor state.
- MUST disable or clearly gate submission while the focused agent is not ready.
</requirements>

## Subtasks
- [ ] 10.1 Render the multi-line editor bound to the focused agent
- [ ] 10.2 Implement Enter-submit, Shift+Enter-newline, and Esc-interrupt
- [ ] 10.3 Route submit to `sendPrompt` and interrupt to `cancel`
- [ ] 10.4 Handle bracketed paste including large pastes
- [ ] 10.5 Gate submission when the focused agent is not ready
- [ ] 10.6 Cover key handling and send/cancel routing with tests

## Implementation Details
Create the prompt editor. See TechSpec "System Architecture → UI Shell" (`PromptEditor`) and PRD UX (Enter/Shift+Enter/Esc). Use the `@opentui/react` `<textarea>`, `useKeyboard`, and `usePaste`. Send/cancel call controller actions from task_07; mounts under the conversation region from task_08.

### Relevant Files
- `src/ui/PromptEditor.tsx` — new; the composer and key handling
- `src/ui/PromptEditor.test.tsx` — new; tests

### Dependent Files
- `src/ui/CockpitApp.tsx` (task_08) — hosts the editor
- `src/app/actions.ts` (task_07) — `sendPrompt`/`cancel` invoked here

### Related ADRs
- [ADR-004: React Binding for the OpenTUI UI Layer](adrs/adr-004.md) — key handling and paste via the React binding

## Deliverables
- Prompt editor with submit/newline/interrupt and paste handling
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test of the send-and-interrupt round-trip against a mock controller **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] Enter with non-empty content calls `sendPrompt` with the composed text and clears the editor
  - [ ] Shift+Enter inserts a newline and does not submit
  - [ ] Esc while the focused agent is working calls `cancel`
  - [ ] A large bracketed paste is inserted intact without truncating editor state
  - [ ] Submission is gated when the focused agent is not ready
- Integration tests:
  - [ ] Against a mock controller, composing then submitting then interrupting invokes `sendPrompt` and `cancel` in order
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The editor follows Enter/Shift+Enter/Esc conventions and routes through the controller
- Large pastes are handled without corruption
