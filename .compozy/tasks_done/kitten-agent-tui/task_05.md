---
status: completed
title: "Reactive app store"
type: frontend
complexity: medium
dependencies:
  - task_02
  - task_03
---

# Task 05: Reactive app store

## Overview
Build the in-memory reactive store that holds both agents' `SessionState`, the focused agent, per-agent status, and overlay state, applying incoming domain events through the core reducer.
It exposes narrow selectors so React components subscribe only to what they render, which is how Kitten keeps streaming updates from re-rendering the whole transcript (ADR-004).

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST hold per-agent `SessionState`, the focused `AgentId`, per-agent status, and overlay slots for the approval prompt and hand-off preview.
- MUST apply `DomainSessionEvent`s to the correct agent slice via the core reducer (task_02) without mutating prior state.
- MUST expose narrow selectors/subscriptions so a token update re-renders only the affected view, not the whole tree (ADR-004).
- MUST accept already-coalesced streaming updates from the adapter layer and not re-batch content itself.
- MUST provide actions to set focus and to open/close overlay slots that later UI tasks populate.
</requirements>

## Subtasks
- [x] 5.1 Define the store shape (per-agent sessions, focus, status, overlay slots)
- [x] 5.2 Apply domain events to the correct agent slice through the core reducer
- [x] 5.3 Implement narrow selectors for status strip, conversation, and overlays
- [x] 5.4 Implement focus and overlay open/close actions
- [x] 5.5 Cover event application, focus switching, and selector isolation with tests

## Implementation Details
Create the store using an external store with targeted subscriptions (per ADR-004; a scoped store such as Zustand or a narrowly-scoped reducer). See TechSpec "System Architecture → Reactive Store" for responsibilities. The store consumes the domain event stream from task_03 and the reducer from task_02.

### Relevant Files
- `src/store/appStore.ts` — new; the store, actions, and event application
- `src/store/selectors.ts` — new; narrow selectors
- `src/store/appStore.test.ts` — new; tests

### Dependent Files
- `src/app/controller.ts` (task_07) — dispatches events and actions into the store
- `src/ui/*` (tasks 08-12) — subscribe via selectors
- `src/telemetry/recorder.ts` (task_13) — observes store transitions

### Related ADRs
- [ADR-003: Layered Architecture with an ACP Anti-Corruption Layer](adrs/adr-003.md) — store sits above the core, below the UI
- [ADR-004: React Binding for the OpenTUI UI Layer](adrs/adr-004.md) — narrow subscriptions to contain re-renders

## Deliverables
- Reactive store with per-agent state, focus, overlays, and selectors
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test dispatching a scripted event stream and asserting final store state **(REQUIRED)**

## Tests
- Unit tests:
  - [x] An `agent_message` event for `claude-code` updates only that agent's slice, leaving `codex` untouched
  - [x] Setting focus to `codex` changes the focused selector's value and nothing else
  - [x] Opening the approval overlay slot exposes it via the overlay selector; closing clears it
  - [x] A selector for agent A's status does not notify when agent B's status changes (subscription isolation)
- Integration tests:
  - [x] Dispatching a scripted stream (both agents interleaved) produces the expected per-agent `SessionState`
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Selector subscriptions are isolated so unaffected views do not re-render
- The store applies domain events to the correct agent slice via the core reducer
