---
status: pending
title: "Shell store slice, pane focus, and selectors"
type: backend
complexity: medium
dependencies:
  - task_01
---

# Task 02: Shell store slice, pane focus, and selectors

## Overview
Extend the application store with the `shell` slice and a generalized keyboard-focus model.
Replace the agent-only `focusedAgentId` mental model with a `focusedPane` union so the shell can own the keyboard, and expose narrow selectors so views re-render only when their slice changes.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `shell: ShellState` to `AppState` and initialize it via `createShellState()`.
- MUST add `focusedPane: { kind: "agent"; agentId: AgentId } | { kind: "shell" }` to `AppState`, keeping the existing `focusedAgentId` as the active-agent field the conversation behind the shell reads.
- MUST add `applyShellEvent(event)` that routes through `shellReducer` and commits with structural sharing (no hand-written `ShellState`).
- MUST add `setFocusedPane(pane)` as a no-op when the pane is unchanged, mirroring `setFocus`.
- MUST add `selectShell`, `selectFocusedPane`, and `selectIsShellFocused` to `src/store/selectors.ts`, each reading the smallest slice.
- SHOULD keep the shell slice untouched when an agent event is applied, so agent updates never notify shell subscribers.
</requirements>

## Subtasks
- [ ] 2.1 Add `shell` and `focusedPane` to `AppState` and the store constructor
- [ ] 2.2 Implement `applyShellEvent` routing through `shellReducer`
- [ ] 2.3 Implement `setFocusedPane` with the unchanged-is-no-op guard
- [ ] 2.4 Add the shell and focused-pane selectors
- [ ] 2.5 Confirm structural sharing keeps unrelated subscribers silent

## Implementation Details
Modify `src/store/appStore.ts` and `src/store/selectors.ts`. Follow the store's existing conventions: immutable `commit`, `subscribeSelector` narrowing, and no-op guards on setters. See TechSpec "Data Models" for the store additions and `AppState` shape.

### Relevant Files
- `src/store/appStore.ts` — `AppState`, the store class, `applyEvent`/`setFocus` patterns to mirror
- `src/store/selectors.ts` — curried selector conventions
- `src/store/appStore.test.ts` — store test conventions
- `src/store/selectors.test.ts` — selector test conventions

### Dependent Files
- `src/ui/ShellPane.tsx` — reads `selectShell` (task_08)
- `src/ui/CockpitApp.tsx` — reads `selectFocusedPane`/`selectIsShellFocused` (task_09)
- `src/app/controller.ts` — calls `applyShellEvent` (task_05)

### Related ADRs
- [ADR-005: In-Pane Interactive Apps, Pane Focus, and Ctrl+C Routing](adrs/adr-005.md) — defines the pane-focus union

## Deliverables
- `shell` slice and `focusedPane` on `AppState`, plus `applyShellEvent` and `setFocusedPane`
- Shell and focused-pane selectors
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for slice isolation **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `applyShellEvent` with a `cwd_changed` updates only the shell slice; the sessions slice keeps identity
  - [ ] `setFocusedPane` to the current pane does not notify subscribers
  - [ ] `setFocusedPane` from agent to shell notifies a `selectFocusedPane` subscriber exactly once
  - [ ] `selectIsShellFocused` returns true only when `focusedPane.kind === "shell"`
  - [ ] applying an agent event leaves `selectShell` reference-equal (no shell-subscriber notification)
- Integration tests:
  - [ ] a sequence of shell and agent events notifies only the matching selector subscribers
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Agent-only focus is generalized to a pane union without breaking existing agent focus behavior
- Existing store tests still pass
