---
status: completed
title: Controller - thread MCP list, resolve, and record readout
type: backend
complexity: high
dependencies:
    - task_02
    - task_04
---

# Task 05: Controller - thread MCP list, resolve, and record readout

## Overview
Wire MCP provisioning into the controller's per-session boot: read the global list from `AppConfig`, resolve it (env plus command) via the resolver, pass the resolved servers to `newSession`, and record a per-agent `{ loaded, skipped }` readout on `AgentRuntimeState`.
This is where declared config becomes tools in both agents and where the readout data originates.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST thread `AppConfig.mcpServers` into `startSession` within `createSessionController`.
- MUST call the resolver (task_02) with the global list and `process.env` once at boot, before creating sessions, so both agents receive the same resolved list.
- MUST pass the resolved servers to `connection.newSession(seed.cwd, resolved)`.
- MUST extend the ready variant of `AgentRuntimeState` with `mcp: { loaded: string[]; skipped: { name: string; reason: string }[] }`, populated from the resolver result.
- MUST NOT block session start when a server is skipped; a skipped server is recorded, not fatal.
</requirements>

## Subtasks
- [ ] 05.1 Read `config.mcpServers` and resolve it once at boot.
- [ ] 05.2 Pass the resolved servers to `newSession` in `startSession`.
- [ ] 05.3 Extend the ready variant of `AgentRuntimeState` with the `mcp` readout.
- [ ] 05.4 Populate `loaded`/`skipped` per agent from the resolver result.
- [ ] 05.5 Ensure a skipped server never blocks session start.

## Implementation Details
Modify `src/app/controller.ts` (`AgentRuntimeState`, `startSession`, `runtimes()`).
Config already flows in through `createCockpitSession`'s `{ config, store }`, so no `index.ts` change should be needed; verify this.
See the TechSpec "System Architecture" (Controller) and "Core Interfaces" (the `AgentRuntimeState` `mcp` field).

### Relevant Files
- `src/app/controller.ts` — `createSessionController`, `startSession`, `AgentRuntimeState`, `runtimes()`.
- `src/app/controller.test.ts` — `StubConnection`-based controller tests.
- `src/config/mcpResolver.ts` — the resolver from task_02.
- `src/index.ts` — `createCockpitSession` already passes `config`; confirm no change required.

### Dependent Files
- `src/ui/StatusStrip.tsx` — reads `AgentRuntimeState` via `controller.runtimes()` (task_06).
- `src/app/selfCheck.ts` — parallel readout surface (task_06).

### Related ADRs
- [ADR-002: V1 Product Scope](adrs/adr-002.md) — single global list, both agents identical.
- [ADR-004: Environment-Reference Resolution and Failure Semantics](adrs/adr-004.md) — skip never blocks.
- [ADR-001: MCP Propagation Mechanism](adrs/adr-001.md) — inject at session creation.

## Deliverables
- MCP provisioning threaded through the controller boot path.
- `AgentRuntimeState.mcp` readout populated per agent.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests through `createSessionController` with a stub connection **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] A config declaring one resolvable stdio server results in `startSession` calling `newSession` with a one-element resolved list, and `runtime.mcp.loaded` contains that server name.
  - [ ] A config declaring a server referencing an unset `${VAR}` still starts the session (`ready: true`) and `mcp.skipped` names that server with the unresolved-variable reason.
  - [ ] An empty `mcpServers` config yields empty `mcp.loaded` and `mcp.skipped`, with behavior otherwise unchanged.
  - [ ] Both agents' runtimes report the same `loaded` set for the same global config.
- Integration tests:
  - [ ] Through `createSessionController` with a `StubConnection`, a declared server appears in the captured `newSession` args and in `runtimes()[].mcp.loaded`.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Skipped servers never block startup
- Both agents receive an identical resolved list
- `AgentRuntimeState.mcp` populated with loaded and skipped entries
