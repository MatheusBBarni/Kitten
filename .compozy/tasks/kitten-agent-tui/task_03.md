---
status: pending
title: "Agent adapter layer and ACP translation"
type: backend
complexity: high
dependencies:
  - task_01
  - task_02
---

# Task 03: Agent adapter layer and ACP translation

## Overview
Build the `AgentConnection` adapter that launches an agent as a subprocess, speaks ACP over its stdio, and translates the ACP `SessionNotification` union into Kitten's domain events.
This is the anti-corruption boundary and the highest-integration-risk component, so it ships with a mock in-process ACP agent for deterministic tests and buffers streaming chunks for the store.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST implement the `AgentConnection` interface from the TechSpec "Core Interfaces" (`connect`, `newSession`, `prompt`, `cancel`, `onUpdate`, `onPermission`, `dispose`).
- MUST spawn the agent via `Bun.spawn` and drive an ACP `ClientSideConnection` over the child's stdin/stdout.
- MUST implement the ACP `Client` interface callbacks, including `requestPermission` and filesystem callbacks, and route permission requests through the `onPermission` handler.
- MUST translate every relevant `SessionNotification` variant into a `DomainSessionEvent`; NO ACP wire type may escape this layer (ADR-003).
- MUST buffer `agent_message_chunk` deltas and flush them at most once per animation frame so downstream rendering stays flicker-free (ADR-004).
- MUST provide a mock in-process ACP agent test double that emits scripted notifications and permission requests.
</requirements>

## Subtasks
- [ ] 3.1 Implement the `Bun.spawn` stdio transport and ACP `ClientSideConnection` wiring
- [ ] 3.2 Implement the ACP `Client` callbacks (`requestPermission`, filesystem) and the `initialize` handshake in `connect`
- [ ] 3.3 Translate the `SessionNotification` union into `DomainSessionEvent`s
- [ ] 3.4 Add per-frame coalescing of streamed agent-message deltas
- [ ] 3.5 Build the mock in-process ACP agent test double
- [ ] 3.6 Cover translation, permission round-trip, and coalescing with tests against the mock

## Implementation Details
Create the adapter layer. See TechSpec "Core Interfaces" for the `AgentConnection` contract, "Integration Points" for transport and error handling, and ADR-005 for the config-driven spawn model. The ACP SDK is imported only in this layer. Streaming buffer lives here so the store receives batched updates.

### Relevant Files
- `src/agent/agentConnection.ts` — new; the adapter implementing `AgentConnection`
- `src/agent/acpTranslate.ts` — new; `SessionNotification` → `DomainSessionEvent`
- `src/agent/transport.ts` — new; `Bun.spawn` stdio wiring for the ACP connection
- `test/mockAgent.ts` — new; in-process ACP `Agent` test double
- `src/agent/agentConnection.test.ts`, `src/agent/acpTranslate.test.ts` — new; tests

### Dependent Files
- `src/store/appStore.ts` (task_05) — consumes the `DomainSessionEvent` stream
- `src/app/controller.ts` (task_07) — creates and orchestrates `AgentConnection`s
- `src/config/readiness.ts` (task_04) — uses `connect` for the readiness handshake

### Related ADRs
- [ADR-003: Layered Architecture with an ACP Anti-Corruption Layer](adrs/adr-003.md) — this is the anti-corruption boundary
- [ADR-005: BYO Agents via Config-Driven ACP Subprocess Spawn](adrs/adr-005.md) — spawn-from-config model

## Deliverables
- `AgentConnection` adapter with ACP translation and streaming coalescing
- Mock in-process ACP agent for tests
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests driving the adapter against the mock agent **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `agent_message_chunk` notifications translate to `agent_message` domain events carrying `textDelta`
  - [ ] `tool_call` and `tool_call_update` translate to `tool_call` domain events preserving `kind`, `locations`, and diff content
  - [ ] Two chunk deltas arriving within one frame flush as a single coalesced update
  - [ ] No object emitted by `onUpdate` contains an ACP-only field (translation completeness)
- Integration tests:
  - [ ] Against the mock agent: `connect` completes the `initialize` handshake and returns ready
  - [ ] A scripted `requestPermission` is routed to `onPermission` and the selected outcome is returned to the agent
  - [ ] A full scripted prompt turn (message → tool_call → completion) yields the expected ordered `DomainSessionEvent`s
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The adapter drives a mock ACP agent end to end with correct translation and permission handling
- The ACP SDK is imported only under `src/agent`
