---
status: completed
title: "Controller action and session-start seeding"
type: backend
complexity: medium
dependencies:
  - task_03
  - task_04
---

# Task 05: Controller action and session-start seeding

## Overview
Wire the UI-to-adapter path for switching: a `setSessionConfigOption` controller action that resolves the live session and calls the adapter, plus seeding the captured session-start options into the store when an agent starts.
This keeps the UI free of ACP concerns and gives it a single action to call.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `setSessionConfigOption(configId, value, agentId?)` to `ControllerActions`, defaulting to the focused agent and mirroring the `sendPrompt`/`cancel` action pattern.
- MUST resolve the live session via `getSession` and call the adapter method from task_03, degrading through the existing `onError` path on failure.
- MUST seed the session-start `config_options` into the store during `startAgent` so the selector is populated before first use.
- MUST NOT apply optimistic state; the store is updated only from the adapter-reported option set (per ADR-004).
- MUST NOT introduce a separate flow module for the selector (the action plus the store slot are sufficient; YAGNI).
</requirements>

## Subtasks
- [x] 5.1 Add `setSessionConfigOption` to the `ControllerActions` interface
- [x] 5.2 Implement it in `createControllerActions`, resolving the session and calling the adapter
- [x] 5.3 Seed captured session-start options into the store in `startAgent`
- [x] 5.4 Route the adapter-reported result into the store via `applyEvent`, not optimistically
- [x] 5.5 Cover the action and seeding with unit tests using a fake connection

## Implementation Details
Modify the controller and actions. See TechSpec "System Architecture" (Controller / Actions) and ADR-004. Mirror `sendPrompt` (`actions.ts:78-93`); `getSession` builds the live `AgentSession` (`controller.ts:120-124`); `startAgent` calls `newSession` and subscribes updates (`controller.ts:127-153`).

### Relevant Files
- `src/app/actions.ts` — `ControllerActions` (44-57), `createControllerActions` (70-113), `AgentSession` (24-28)
- `src/app/controller.ts` — `getSession` (120-124), `startAgent` (127-153)
- `src/app/actions.test.ts`, `src/app/controller.test.ts` — action/controller unit tests

### Dependent Files
- `src/ui/ModelSelect.tsx` (task_06) — calls `actions.setSessionConfigOption`
- `src/app/handoff.ts` (task_08) — applies the target's config through this action

### Related ADRs
- [ADR-004: Live in-place switching with confirmed-state UI and a category allowlist](adrs/adr-004.md) — confirmed-state, no optimistic update
- [ADR-003: Generic config-option channel in the domain core](adrs/adr-003.md) — the event carrying the reported options

## Deliverables
- The `setSessionConfigOption` controller action
- Session-start config-option seeding in `startAgent`
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test from action call through store update **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `setSessionConfigOption("model", "opus", "codex")` targets the codex session and calls the adapter with those args
  - [ ] With no `agentId`, the action targets the focused agent
  - [ ] When `getSession` returns undefined, the action no-ops without throwing
  - [ ] An adapter error is routed to `onError` and does not update the store
  - [ ] `startAgent` seeds the session-start options into the store as a `config_options` event
- Integration tests:
  - [ ] Calling the action with a fake connection returning a refreshed set updates `selectAgentModel` (task_04) to the reported value, not the requested one
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The UI can switch via one controller action; the store reflects only adapter-reported state
- Session-start options populate the selector before first use
