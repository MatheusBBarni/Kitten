---
status: completed
title: Adapter-honor smoke test and fixture MCP server
type: test
complexity: medium
dependencies:
    - task_04
---

# Task 08: Adapter-honor smoke test and fixture MCP server

## Overview
Build the release gate mandated by ADR-005: a fixture stdio MCP server exporting one known tool, and a real-subprocess smoke test that spawns each pinned adapter, injects the fixture via `newSession`, and asserts the tool appears in the session.
This is the only test that proves the adapters actually honor client-provided MCP servers, and a red result is a hard release blocker.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a minimal fixture stdio MCP server that exports one deterministic, named tool.
- MUST add a smoke test that, for each pinned adapter (`claude-agent-acp@0.57.0`, `codex-acp@1.1.0`), spawns the real adapter, creates a session injecting the fixture server, and asserts the fixture's named tool is present.
- MUST run under a dedicated script (for example `bun run test:mcp-smoke`) separate from the default `bun test` path.
- MUST treat a missing or failed tool as a failing gate.
- SHOULD assert the specific named tool, not merely a nonzero server count.
</requirements>

## Subtasks
- [ ] 08.1 Implement the fixture stdio MCP server exporting one named tool.
- [ ] 08.2 Add the smoke test that spawns each pinned adapter and injects the fixture.
- [ ] 08.3 Assert the fixture's named tool appears in the session for each adapter.
- [ ] 08.4 Add the `test:mcp-smoke` script and keep it out of the default test run.

## Implementation Details
Add a fixture MCP server under the test tree, a smoke-test file, and a `package.json` script.
Use the real adapter spawn path (`transport.ts`, the pinned adapter package constants in `configLoader.ts`) rather than the in-memory pair.
See the TechSpec "Testing Approach" (Integration Tests) and ADR-005.

### Relevant Files
- `package.json` — add the `test:mcp-smoke` script.
- `src/agent/transport.ts` — real adapter spawn recipe (command, args, env).
- `src/config/configLoader.ts` — `CLAUDE_CODE_ACP_PACKAGE` / `CODEX_ACP_PACKAGE` pinned constants.

### Dependent Files
- None.

### Related ADRs
- [ADR-005: Adapter-Honor Smoke Test](adrs/adr-005.md) — the gate definition.
- [ADR-001: MCP Propagation Mechanism](adrs/adr-001.md) — inject over the session.

## Deliverables
- A fixture stdio MCP server exporting one named tool.
- A real-subprocess smoke test asserting tool presence per adapter.
- A dedicated `test:mcp-smoke` script excluded from the default suite.
- Unit tests for the fixture server with 80%+ coverage **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] The fixture MCP server, invoked directly, advertises exactly the one expected named tool.
- Integration tests:
  - [ ] Spawning `claude-agent-acp@0.57.0` and creating a session with the fixture injected yields a session exposing the fixture's named tool.
  - [ ] Spawning `codex-acp@1.1.0` and creating a session with the fixture injected yields a session exposing the fixture's named tool.
  - [ ] The gate exits non-zero if either adapter's session lacks the fixture tool.
- Test coverage target: >=80% (fixture server code)
- All tests must pass
- Note: requires the pinned adapters installed in the run environment (technical dependency).

## Success Criteria
- All tests passing
- Test coverage >=80% for the fixture server
- The fixture server exports the expected named tool
- The smoke test asserts tool presence per pinned adapter
- The dedicated script runs outside the default suite and a red result is a hard gate
