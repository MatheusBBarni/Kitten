---
status: pending
title: "Adapter live setSessionConfigOption and capture"
type: backend
complexity: medium
dependencies:
  - task_01
  - task_02
---

# Task 03: Adapter live setSessionConfigOption and capture

## Overview
Extend the agent adapter to change a pane's model and effort on the live ACP session and to stop discarding the options the session already reports.
This adds `setSessionConfigOption` to `AgentConnection` and captures `newSession`'s `configOptions`, returning the full agent-confirmed option set so higher layers can render confirmed state.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `setSessionConfigOption(sessionId, configId, value)` to `AgentConnection`, calling the SDK `ClientSideConnection.setSessionConfigOption` and returning the refreshed option set mapped to `ConfigOption[]`.
- MUST capture `newSession`'s `configOptions` (currently discarded) and emit them as an initial `config_options` domain event through the existing update path.
- MUST leave the session live on a switch (no teardown, no re-spawn).
- MUST surface adapter/transport failures through the existing error path rather than throwing into the UI.
- MUST verify at implementation time that both pinned adapters advertise `model` and `thought_level` in a live handshake; if an adapter advertises neither, the adapter layer MUST emit an empty option set rather than fabricate one.
- MUST keep the ACP SDK confined to `src/agent`.
</requirements>

## Subtasks
- [ ] 3.1 Add `setSessionConfigOption` to the `AgentConnection` interface and implementation
- [ ] 3.2 Capture `newSession.configOptions` and emit an initial `config_options` event
- [ ] 3.3 Map SDK `SetSessionConfigOptionResponse.configOptions` to domain `ConfigOption[]`
- [ ] 3.4 Confirm both pinned adapters advertise `model`/`thought_level` in a live handshake and record the result
- [ ] 3.5 Cover the round-trip and capture with the in-process mock agent

## Implementation Details
Modify the adapter. See TechSpec "System Architecture" (Agent Adapter Layer), "Integration Points", and ADR-004. The switch calls `requireConnection().setSessionConfigOption`; `newSession` currently returns only `sessionId` (lines 176-180). Extend `test/mockAgent.ts` to serve `configOptions`, answer `setSessionConfigOption`, and optionally emit `config_option_update`.

### Relevant Files
- `src/agent/agentConnection.ts` — `AgentConnection` interface (lines 78-87), `newSession` (176-180), `requireConnection` (299-302), update routing (233-242)
- `src/agent/acpTranslate.ts` — reused for translating captured/updated options (task_02)
- `test/mockAgent.ts` — extend to serve/answer config options
- `src/agent/agentConnection.test.ts` — adapter round-trip tests over the in-memory transport pair

### Dependent Files
- `src/app/controller.ts` (task_05) — will seed captured options and call the new method
- `src/app/actions.ts` (task_05) — the controller action wraps this adapter method

### Related ADRs
- [ADR-004: Live in-place switching with confirmed-state UI and a category allowlist](adrs/adr-004.md) — live switch, confirmed state, capture on session start
- [ADR-003: Generic config-option channel in the domain core](adrs/adr-003.md) — the mapped domain shape

## Deliverables
- `AgentConnection.setSessionConfigOption` and `newSession` config-option capture
- An extended mock agent that serves and answers config options
- A recorded confirmation that both pinned adapters advertise `model`/`thought_level`
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests against the mock agent **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `newSession` returning two config options emits a `config_options` domain event with both mapped
  - [ ] `newSession` returning no config options emits an empty `config_options` event (no fabrication)
  - [ ] `setSessionConfigOption` returns the mapped refreshed option set from the mock's response
  - [ ] A transport error from `setSessionConfigOption` is surfaced via the error path, not thrown to the caller
- Integration tests:
  - [ ] Driving the real adapter against the mock agent: a `setSessionConfigOption` call changes the mock's `currentValue` and the returned/emitted options reflect it, with the session still live afterward
  - [ ] A mock-emitted `config_option_update` after the switch produces a `config_options` domain event
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The adapter switches model/effort on the live session and reports the confirmed option set
- Captured `newSession` options reach the store; no ACP SDK import outside `src/agent`
