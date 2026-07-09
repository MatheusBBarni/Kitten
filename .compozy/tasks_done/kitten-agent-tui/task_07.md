---
status: completed
title: "Session controller and orchestration"
type: backend
complexity: high
dependencies:
  - task_03
  - task_04
  - task_05
---

# Task 07: Session controller and orchestration

## Overview
Build the controller that constructs both `AgentConnection`s from config, opens a session per agent, subscribes their event streams into the store, and exposes the action surface the UI calls.
It keeps both sessions live and resumable within a run and routes permission requests into store overlay state, so the UI never touches the adapter directly.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST construct an `AgentConnection` per configured agent, connect each, and open a session with the current working directory.
- MUST subscribe each connection's `onUpdate` stream and dispatch domain events into the correct store slice.
- MUST expose actions consumed by the UI: `sendPrompt`, `cancel`, `switchFocus`, and `respondPermission`.
- MUST route ACP permission requests from a connection into the store's approval overlay slot and resolve them with the user's outcome.
- MUST keep both sessions alive and addressable for the duration of the run so a task can be handed off and handed back.
- MUST degrade gracefully: a single connection failing must not tear down the app or the other agent.
</requirements>

## Subtasks
- [x] 7.1 Construct and connect both `AgentConnection`s from config and open sessions
- [x] 7.2 Subscribe each connection's update stream into the store
- [x] 7.3 Expose `sendPrompt`, `cancel`, `switchFocus`, and `respondPermission` actions
- [x] 7.4 Route permission requests into the approval overlay slot and resolve outcomes
- [x] 7.5 Handle single-connection failure without crashing the app
- [x] 7.6 Cover orchestration and permission routing with tests against mock connections

## Implementation Details
Create the controller/orchestrator that ties config, connections, and store together and exposes actions. See TechSpec "System Architecture → Data flow" for the wiring and ADR-005 for the connection model. This task deliberately extracts orchestration so the store stays a lean state container.

### Relevant Files
- `src/app/controller.ts` — new; constructs connections, wires streams, holds sessions
- `src/app/actions.ts` — new; the action surface the UI calls
- `src/app/controller.test.ts` — new; tests against mock connections

### Dependent Files
- `src/ui/CockpitApp.tsx` (task_08) — invokes `switchFocus` and reads readiness
- `src/ui/PromptEditor.tsx` (task_10) — invokes `sendPrompt`/`cancel`
- `src/ui/ApprovalPrompt.tsx` (task_11) — invokes `respondPermission`
- `src/app/handoff.ts` (task_12) — uses `sendPrompt` on the target agent

### Related ADRs
- [ADR-003: Layered Architecture with an ACP Anti-Corruption Layer](adrs/adr-003.md) — controller sits between adapters and store
- [ADR-005: BYO Agents via Config-Driven ACP Subprocess Spawn](adrs/adr-005.md) — construct connections from config

## Deliverables
- Session controller with the UI action surface and permission routing
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test orchestrating two mock connections through prompt and permission flows **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `sendPrompt` on the focused agent calls that connection's `prompt` with the composed blocks
  - [x] `switchFocus` updates the store's focused agent and leaves both sessions alive
  - [x] A permission request from a connection opens the approval overlay slot with the request details
  - [x] `respondPermission` resolves the pending request with the chosen outcome
- Integration tests:
  - [x] With two mock connections, a prompt to agent A streams into A's slice while B stays idle and addressable
  - [x] A mock connection that fails to connect is reported not-ready while the other agent remains usable
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Both agent sessions stay live and addressable throughout a run
- The UI can drive prompts, focus, and permissions solely through the controller's actions
