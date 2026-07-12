---
status: pending
title: ACP MCP translator - domain to SDK McpServer
type: backend
complexity: low
dependencies:
  - task_01
---

# Task 03: ACP MCP translator - domain to SDK McpServer

## Overview
Add the pure translator that maps resolved `McpServerConfig` entries to the ACP SDK `McpServer` stdio shape, converting the env map into the SDK's name/value array.
This is the only place the SDK `McpServer` type is constructed, preserving the anti-corruption boundary that keeps SDK types inside `src/agent`.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST implement `toAcpMcpServers(servers: McpServerConfig[]): McpServer[]` in `src/agent/acpTranslate.ts`.
- MUST map each server to the stdio `McpServer` variant with name, command, args, and env converted from `Record<string,string>` to an array of `{ name, value }`.
- MUST keep the SDK `McpServer` type inside `src/agent`; it MUST NOT leak into `src/core` or `src/app`.
- MUST treat input commands as already absolute and env as already expanded (resolution is task_02); the translator performs shape mapping only.
- SHOULD preserve the input server order in the output.
</requirements>

## Subtasks
- [ ] 03.1 Add `toAcpMcpServers` to `acpTranslate.ts`.
- [ ] 03.2 Convert each env map into the SDK `EnvVariable` array shape.
- [ ] 03.3 Produce the stdio `McpServer` variant per server, preserving order.

## Implementation Details
Modify `src/agent/acpTranslate.ts`, the established domain-to-SDK translation home.
See the TechSpec "Core Interfaces" (`toAcpMcpServers`) and "Data Models" (ACP wire shape).
ADR-003 mandates translation lives here so no SDK MCP type escapes the boundary.

### Relevant Files
- `src/agent/acpTranslate.ts` — translation home; add the helper next to `translateSessionUpdate`/`translateToolCall`.
- `src/agent/acpTranslate.test.ts` — existing translation tests to extend.

### Dependent Files
- `src/agent/agentConnection.ts` — calls `toAcpMcpServers` inside `newSession` (task_04).

### Related ADRs
- [ADR-003: MCP Server Domain Model and ACP Translation Boundary](adrs/adr-003.md) — translation confined to `src/agent`, env-as-array.

## Deliverables
- The `toAcpMcpServers` translator.
- Unit tests with 80%+ coverage **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] A server `{ name:"gh", command:"/abs/npx", args:["-y","x"], env:{A:"1",B:"2"} }` maps to a stdio `McpServer` whose env is `[{name:"A",value:"1"},{name:"B",value:"2"}]`.
  - [ ] An empty input array returns an empty array.
  - [ ] A server with an empty env map maps to an empty env array.
  - [ ] Two servers appear in the output in the same order as the input.
- Integration tests:
  - [ ] Covered by task_04's in-memory contract test asserting the translated shape reaches the agent side (referenced, not duplicated here).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- SDK `McpServer` type stays inside `src/agent`
- Env map converted to the name/value array shape
- Server order preserved
