---
status: completed
title: Widen AgentConnection.newSession and update fakes
type: backend
complexity: medium
dependencies:
    - task_01
    - task_03
---

# Task 04: Widen AgentConnection.newSession and update fakes

## Overview
Widen the `AgentConnection.newSession` contract to accept the resolved MCP server list, translate it via `toAcpMcpServers`, and pass it to the ACP `session/new` call in place of the hardcoded empty array.
Every fake implementing the interface is updated, and an in-memory contract test proves the array reaches the agent side.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST change the `AgentConnection` interface method to `newSession(cwd: string, mcpServers: McpServerConfig[]): Promise<string>`.
- MUST, in the real implementation, translate the list with `toAcpMcpServers` and pass it to `connection.newSession`, replacing the current `mcpServers: []`.
- MUST update every fake implementing `AgentConnection`: the `StubConnection` in the controller tests, `createOfflineConnection` in `selfCheck.ts`, and any in-memory ACP stub.
- MUST NOT resolve env or command here; this task passes already-resolved servers through translation only (resolution is task_02).
- MUST add an in-memory contract test using the in-process transport pair asserting the injected servers reach the agent side.
</requirements>

## Subtasks
- [ ] 04.1 Widen the `AgentConnection.newSession` signature.
- [ ] 04.2 Translate and pass servers in the real `newSession`, removing the hardcoded `[]`.
- [ ] 04.3 Update `StubConnection`, `createOfflineConnection`, and in-memory stubs to the new signature.
- [ ] 04.4 Add an in-memory contract test asserting the injected servers arrive on the agent side.

## Implementation Details
Modify `src/agent/agentConnection.ts` (interface plus the `newSession` implementation at the `mcpServers: []` call site) and update the fakes in `src/app/controller.test.ts` (`StubConnection`) and `src/app/selfCheck.ts` (`createOfflineConnection`).
Use `createInMemoryTransportPair` from `transport.ts` for the contract test.
See the TechSpec "Core Interfaces" and "Impact Analysis" sections.

### Relevant Files
- `src/agent/agentConnection.ts` — `AgentConnection` interface and the `newSession` implementation (currently `mcpServers: []`).
- `src/agent/transport.ts` — `createInMemoryTransportPair` seam for the contract test.
- `src/app/controller.test.ts` — `StubConnection` fake that captures `newSession` args.
- `src/app/selfCheck.ts` — `createOfflineConnection` fake whose `newSession` throws.

### Dependent Files
- `src/app/controller.ts` — the sole caller of `newSession`, updated in task_05.

### Related ADRs
- [ADR-003: MCP Server Domain Model and ACP Translation Boundary](adrs/adr-003.md) — where translation happens.
- [ADR-001: MCP Propagation Mechanism](adrs/adr-001.md) — inject over the session.

## Deliverables
- Widened `newSession` that translates and passes servers, with the hardcoded `[]` removed.
- Every `AgentConnection` fake updated to the new signature.
- In-memory contract test.
- Unit tests with 80%+ coverage **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] `newSession` with a one-server list calls the underlying `connection.newSession` with a `mcpServers` array of length one carrying that server's name.
  - [ ] `newSession` with an empty list passes an empty `mcpServers` array and does not throw.
  - [ ] `StubConnection` records the `mcpServers` argument passed by its callers.
- Integration tests:
  - [ ] Contract: over the in-process transport pair, `newSession` with a fixture stdio server results in the agent side receiving a `NewSessionRequest` whose `mcpServers` contains that server (name, command, args, env-as-array).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The hardcoded `mcpServers: []` is removed
- All fakes compile and behave against the new signature
- The contract test asserts the array shape on the agent side
