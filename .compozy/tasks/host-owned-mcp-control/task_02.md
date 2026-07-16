---
status: completed
title: Define the strict agent_run MCP tool contract
type: backend
complexity: medium
---

# Task 02: Define the strict agent_run MCP tool contract

## Overview

Add the narrow public `agent_run` MCP tool for bounded `start` and explicit `poll` requests. The adapter layer validates all caller input and forwards only bounded local frames, leaving ownership and lifecycle decisions to the authenticated application bridge.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. `agent_run` MUST accept only strict discriminated `start` and `poll` requests; unknown fields and caller-supplied parent, session, or generation fields MUST be rejected.
- 2. `start` MUST accept one through four unique, non-empty, byte-bounded task/outcome entries.
- 3. `poll` MUST require a non-empty unique child-ID list and preserve request order in successful snapshots.
- 4. Forwarding and error serialization MUST remain bounded and generic, exposing only `invalid_request`, `unavailable`, or `busy` categories and permitted snapshot fields.
</requirements>

## Subtasks

- [x] 2.1 Define the strict public operation schemas and bounded input rules.
- [x] 2.2 Register `agent_run` alongside the preserved bundled `ask_user` tool.
- [x] 2.3 Forward correlated bounded local frames without caller-owned identity fields.
- [x] 2.4 Serialize accepted snapshots and generic failures without sensitive content.

## Implementation Details

Follow the TechSpec “Data Models,” “API Endpoints,” and “Testing Approach” sections. Reuse the existing child-side socket and JSONL-testing disciplines, but keep capability resolution, route concurrency, and authorization outside this adapter-layer task.

### Relevant Files
- `src/agent/agentRunMcp.ts` — new strict schemas, local forwarding, registrar, and result/error serialization.
- `src/agent/agentRunMcp.test.ts` — new schema, transport, and content-free error coverage.
- `src/agent/kittenMcp.ts` — registers the new tool with the bundled server.
- `src/agent/kittenMcp.test.ts` — verifies dual-tool registration without weakening standalone `ask_user` tests.

### Dependent Files
- `src/agent/askUserMcp.ts` — retained as the compatibility and shared child-side IPC boundary.
- `src/app/kittenMcpBridge.ts` — will consume the `agent_run` frame and result vocabulary.
- `test/askUserMcp.integration.test.ts` — later real-process coverage for both bundled tools.

### Related ADRs
- [ADR-001: Expose a bounded start-and-poll MCP surface](adrs/adr-001.md) — defines the public V1 operations and fail-closed ownership model.
- [ADR-003: Extend the authenticated Kitten MCP bridge with atomic bounded agent control](adrs/adr-003.md) — defines the shared child-process boundary.

## Deliverables

- A strict `agent_run` MCP tool with bounded start and poll inputs.
- Correlated JSONL forwarding and generic stable result/error serialization.
- Dual-tool bundled-server registration tests.
- Unit and adapter-layer integration tests with 80%+ coverage.

## Tests

- Unit tests:
  - [x] A start request with one and four valid distinct task/outcome pairs is accepted for forwarding.
  - [x] Empty, over-limit, duplicate, unknown-key, and caller-identity-bearing start input returns `invalid_request` without forwarding.
  - [x] Empty, duplicate, and malformed poll ID lists return `invalid_request` without forwarding.
  - [x] Oversized, malformed, uncorrelated, and unavailable local frames produce only the approved generic categories and do not echo task or outcome sentinels.
  - [x] Successful snapshots contain only child ID, lifecycle status, and an optional terminal timestamp in request order.
- Integration tests:
  - [x] The bundled server’s tool list contains both `ask_user` and `agent_run` after registration.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Public input cannot select a parent, session, generation, or unbounded work.
- Tool responses never contain task text, provider details, route data, capabilities, or transcripts.
