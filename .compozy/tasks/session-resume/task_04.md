---
status: pending
title: "ACP adapter loadSession and capability capture"
type: backend
complexity: medium
dependencies: []
---

# Task 04: ACP adapter loadSession and capability capture

## Overview
Resume needs the ACP adapter to reload a prior session and to report whether each agent supports it.
This adds a `loadSession` method to the `AgentConnection` adapter and captures the `loadSession` capability that `connect()` currently discards, carrying it out on `ReadyState` for the restore path to branch on.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `loadSession(sessionId, cwd)` to the `AgentConnection` interface and implementation, mirroring `newSession` but calling the SDK `ClientSideConnection.loadSession({ sessionId, cwd, mcpServers: [] })`.
- MUST ensure the re-streamed history arriving after `loadSession` flows through the existing `onUpdate` path with no new translation logic.
- MUST capture `agentCapabilities.loadSession` from the `initialize` response (currently read then discarded) and expose it as `canLoadSession: boolean` on the `ready: true` variant of `ReadyState`.
- MUST keep ACP wire types behind the adapter boundary (translate, do not leak them to callers).
- `loadSession` called before `connect()` MUST throw via the existing `requireConnection` guard.

## Subtasks
- [ ] 4.1 Add `loadSession` to the `AgentConnection` interface
- [ ] 4.2 Implement `loadSession` on the adapter, reusing the client stream path
- [ ] 4.3 Widen `ReadyState` with `canLoadSession` and populate it from `initialize`
- [ ] 4.4 Guard `loadSession` behind `requireConnection`
- [ ] 4.5 Cover capability capture, the load call, streamed replay, and the pre-connect guard in tests

## Implementation Details
Modify `src/agent/agentConnection.ts`: the `AgentConnection` interface, the `ReadyState` type, `connect()` (where `agentCapabilities` is discarded), and add `loadSession` next to `newSession`.
Use the SDK `ClientSideConnection.loadSession` and the `AgentCapabilities.loadSession` field; see the TechSpec "Core Interfaces" and "Integration Points" sections and ADR-004.

### Relevant Files
- `src/agent/agentConnection.ts` — `AgentConnection`, `ReadyState`, `connect()`, `newSession()`, `requireConnection`
- `node_modules/@agentclientprotocol/sdk` — `ClientSideConnection.loadSession`, `LoadSessionRequest`, `AgentCapabilities.loadSession`
- `src/agent/acpTranslate.ts` — confirms streamed updates already translate to domain events

### Dependent Files
- `src/app/controller.ts` — task_07 calls `loadSession` and reads `ReadyState.canLoadSession`
- `src/app/selfCheck.ts` — task_05 uses `loadSession` in the probe
- `src/agent/agentConnection.test.ts` — extend with the new method and capability

### Related ADRs
- [ADR-004: Live Restore via loadSession Replay](../adrs/adr-004.md) — surface the capability, call load, reuse the replay path

## Deliverables
- `AgentConnection.loadSession` and a widened `ReadyState.canLoadSession`
- `agentCapabilities.loadSession` captured at `connect()`
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for streamed replay through `onUpdate` after a load **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `connect()` sets `canLoadSession: true` when the fake `initialize` returns `agentCapabilities.loadSession: true`, and `false` when the field is absent
  - [ ] `loadSession("sess-7", "/repo")` calls the underlying `connection.loadSession` with `{ sessionId: "sess-7", cwd: "/repo", mcpServers: [] }`
  - [ ] `loadSession` before `connect()` throws
- Integration tests:
  - [ ] updates streamed by the fake agent after `loadSession` reach `onUpdate` subscribers as domain events, repopulating a session
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The adapter can load a prior session and reports per-agent `loadSession` support
- Streamed replay reuses the existing update path with no new translation code
