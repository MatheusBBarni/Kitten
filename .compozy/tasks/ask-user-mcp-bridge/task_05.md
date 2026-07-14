---
status: pending
title: Implement the same-binary stdio MCP child and bounded ask_user schema
type: backend
complexity: high
---

# Task 05: Implement the same-binary stdio MCP child and bounded ask_user schema

## Overview

Add the provider-facing `--ask-user-mcp` child mode that exposes one validated `ask_user` MCP tool and forwards its structured result through the authenticated local bridge. The normal Kitten boot path must remain unchanged, and the child must keep stdout reserved exclusively for MCP protocol frames.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. Add `@modelcontextprotocol/sdk` as the exact direct `1.29.0` runtime dependency.
- 2. The child MUST recognize `--ask-user-mcp` before repository, readiness, or TUI boot and connect its MCP server through stdio.
- 3. The `ask_user` schema MUST accept only one to ten fields, at most twenty options per choice field, and at most 4 KiB text values; it MUST have no caller timeout or session-identity field before IPC forwarding.
- 4. Tool responses MUST serialize submitted, skipped, timed_out, and cancelled outcomes; schema and authorization failures MUST be generic and content-free.
</requirements>

## Subtasks

- [ ] 5.1 Add the exact runtime dependency and preserve dependency pinning rules.
- [ ] 5.2 Add the child-only executable dispatch path without introducing import-time boot side effects.
- [ ] 5.3 Implement the bounded MCP tool schema and authenticated IPC client behavior.
- [ ] 5.4 Serialize all terminal outcomes and protect stdout from non-protocol output.

## Implementation Details

Keep MCP SDK and wire types under `src/agent/`. See the TechSpec “Executable mode and MCP SDK,” “API Endpoints,” and “Testing Approach” sections, plus the project dependency rules.

### Relevant Files
- `src/agent/askUserMcp.ts` — new MCP stdio server, schema validator, IPC client, and outcome serializer.
- `src/agent/askUserMcp.test.ts` — new schema, serialization, and client-error tests.
- `src/index.ts` — owns child-mode dispatch before normal boot under `import.meta.main`.
- `package.json` — declares the direct exact SDK dependency.
- `bun.lock` — records the exact resolved SDK dependency.

### Dependent Files
- `test/dependencies.test.ts` — enforces exact dependency and allow-list policy.
- `test/firstRunBoot.test.ts` — protects normal boot gates from child-mode regression.
- `src/app/askUserBridge.ts` — receives authenticated child requests.

### Related ADRs
- [ADR-003: Use a controller-owned bridge with per-session authenticated local IPC](adrs/adr-003.md) — defines same-binary child and transport boundary.
- [ADR-004: Define a bounded multi-field contract with a Kitten-owned five-minute timeout](adrs/adr-004.md) — defines schema limits and no caller timeout override.

## Deliverables

- Direct exact MCP SDK dependency and same-binary child entrypoint.
- Bounded `ask_user` MCP schema with authenticated IPC forwarding.
- Content-free terminal outcome and error serialization.
- Unit and process-mode integration tests with 80%+ coverage.

## Tests

- Unit tests:
  - [ ] A valid one-to-ten-field form with no more than twenty options per choice and 4 KiB text serializes the bridge’s submitted response exactly once.
  - [ ] Empty, oversized, over-limit, duplicate-ID, duplicate-option, and impossible forms return schema errors without form content.
  - [ ] A caller-supplied timeout field is rejected or ignored according to the published schema, never forwarded.
  - [ ] Skip, timeout, and cancellation serialize their distinct terminal categories.
- Integration tests:
  - [ ] The child runs over real stdio against a fake authenticated IPC endpoint and preserves protocol-only stdout.
  - [ ] Normal Kitten self-check/boot behavior does not enter child mode without the explicit flag.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Agents receive one bounded MCP tool with no caller-controlled session or timeout.
- The normal Kitten executable path remains side-effect-free on import and unchanged without the child flag.
