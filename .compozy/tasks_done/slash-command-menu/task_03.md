---
status: completed
title: "selectSessionCommands selector"
type: backend
complexity: low
dependencies:
  - task_01
---

# Task 03: selectSessionCommands selector

## Overview
Add a memoizable per-session selector that exposes a session's advertised commands, mirroring `selectSessionPlan`, so the prompt editor can read the focused agent's commands through a narrow subscription.
Correct structural sharing here is what keeps a command update from re-rendering unrelated views.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `selectSessionCommands(sessionId)` returning `AvailableCommand[]`, curried for call-site memoization, mirroring `selectSessionPlan` per the TechSpec "Core Interfaces" section.
- MUST preserve reference identity of the returned list across store updates that do not touch that session's commands (structural sharing / `Object.is`).
- MUST NOT read state broadly or introduce a focused-session convenience variant beyond the existing pattern.
</requirements>

## Subtasks
- [x] 3.1 Add `selectSessionCommands` next to `selectSessionPlan`.
- [x] 3.2 Add unit tests for the projected value and empty default.
- [x] 3.3 Add an identity test proving unrelated updates do not change the reference.

## Implementation Details
Mirror `selectSessionPlan` (curried `(sessionId) => (state) => state.sessions[sessionId]!.commands`).
See the TechSpec "Implementation Design > Core Interfaces"; do not duplicate the signature here.
Consumers memoize the curried selector with `useMemo` keyed on the session id, per the selectors module contract.

### Relevant Files
- `src/store/selectors.ts` - holds `selectSessionPlan` (the template) and `selectFocusedSessionId`.
- `src/store/selectors.test.ts` - drives a real store and asserts both value and reference identity.

### Dependent Files
- `src/ui/PromptEditor.tsx` - task_07 subscribes to this selector for the focused session.

### Related ADRs
- [ADR-003: Surface agent commands as a config_options-style domain slice](../adrs/adr-003.md) - the selector is the read side of the slice.

## Deliverables
- `selectSessionCommands(sessionId)` selector.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test asserting cross-session identity isolation **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `selectSessionCommands(id)` returns the session's list after a `commands` event is applied.
  - [x] Returns `[]` for a freshly created session.
  - [x] The returned reference is identical (`Object.is`) before and after an unrelated event (e.g. a `status` change) on the same session.
- Integration tests:
  - [x] Applying a `commands` event to session A does not change the reference returned by `selectSessionCommands(B)`.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Reference identity is preserved across unrelated updates.
- The selector mirrors `selectSessionPlan` and is curried for memoization.
