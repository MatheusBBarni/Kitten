---
status: completed
title: Classify bundled MCP failures at the ACP boundary
type: backend
complexity: medium
---

# Task 04: Classify bundled MCP failures at the ACP boundary

## Overview

Translate only the bundled `kitten-ask-user` MCP child's fixed failed-tool
envelope into the closed core failure state. Preserve the ACP anti-corruption
boundary: arbitrary provider content remains unretained and unclassified, while
title-less later updates can still be associated with their eligible tool call.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. MUST recognize eligibility only for a full ACP tool call identified as `mcp.kitten-ask-user.*` and retain only the minimum private tool-call-ID state needed for later ACP updates that omit their title.
- 2. MUST map only an exact single-text JSON envelope containing `busy` or `unavailable` to the core's approved failure kind; malformed JSON, additional keys, different errors, multiple blocks, unrelated servers, and arbitrary text MUST remain generic.
- 3. MUST discard source text after classification and MUST NOT put ACP content, raw output, server metadata, route data, or error strings into core records, UI props, store state, or telemetry.
- 4. MUST remove eligibility state after a terminal tool update and preserve normal ACP translation for diffs, locations, status, and all non-bundled tool calls.
- 5. MUST not change the bundled child's fixed error envelope or add a provider-specific external dependency.
</requirements>

## Subtasks

- [ ] 4.1 Identify and track only eligible bundled MCP tool-call IDs at the agent boundary.
- [ ] 4.2 Classify the exact bounded error envelopes into the core failure vocabulary.
- [ ] 4.3 Preserve existing ACP translation for non-eligible calls and normal tool-call content.
- [ ] 4.4 Retire classifier state on terminal settlement and cover update ordering.
- [ ] 4.5 Prove malformed and privacy-sensitive content cannot cross the adapter boundary.

## Implementation Details

See TechSpec sections “ACP and bundled MCP child”, “Core Interfaces”, and
“Testing Approach”. Keep all ACP inspection in `src/agent`; use the protocol-free
type delivered by Task 03 rather than extending core with SDK shapes.

### Relevant Files

- `src/agent/acpTranslate.ts` — current pure ACP-to-domain tool-call translation and content handling seam.
- `src/agent/acpTranslate.test.ts` — existing translator fixtures for tool-call and update variants.
- `src/agent/agentConnection.ts` — owns ACP session-update lifecycle and any private per-tool-call classifier state.
- `src/agent/agentConnection.test.ts` — verifies emitted domain events from adapter session updates.
- `src/agent/askUserMcp.ts` — defines the fixed JSON error envelope to preserve, not generalize.
- `src/agent/agentRunMcp.ts` — defines the matching fixed error envelope for the bundled delegated-work tool.

### Dependent Files

- `src/core/types.ts` — supplies the closed `ToolCallFailureKind` consumed by adapter output.
- `src/core/sessionReducer.ts` — reduces the emitted optional failure field without ACP knowledge.
- `src/ui/ToolCallRow.tsx` — later renders the domain failure kind without seeing source content.
- `src/agent/askUserMcp.test.ts` and `src/agent/agentRunMcp.test.ts` — preserve the fixed child error-envelope contract that classifier tests consume.

### Related ADRs

- [ADR-001: Keep concurrent MCP admission controller-owned and bounded](adrs/adr-001.md) — keeps authentication and transport authority outside the core.
- [ADR-004: Project closed MCP failures without replaying ambiguous work](adrs/adr-004.md) — selects exact-envelope classification and content-free projection.

## Deliverables

- Private eligible-tool tracking at the ACP boundary.
- Exact bounded-envelope classification into the core failure kind.
- Cleanup and privacy-negative adapter coverage without changing child protocol behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for ACP session-update to domain-event projection **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] A failed full `mcp.kitten-ask-user.ask_user` tool call with exactly `{ "error": "busy" }` maps to `temporary_capacity` and retains no source text.
  - [ ] A title-less later update for a previously eligible bundled tool call maps exactly `{ "error": "unavailable" }` to `unavailable`.
  - [ ] An identical envelope from a different MCP server, a missing-function `mcp.kitten-ask-user` title, a non-MCP tool, malformed JSON, an additional key, multiple content blocks, `invalid_request`, or arbitrary text produces no failure classification.
  - [ ] Terminal completion and failure remove eligibility state, so a later reused or unrelated ID cannot inherit classification.
  - [ ] Existing diff, location, status, and generic tool-call translations remain unchanged.
- Integration tests:
  - [ ] A simulated ACP `session/update` sequence with title on creation and error content on a later update emits one protocol-free domain event with the expected failure kind.
  - [ ] The emitted store-facing event and its serialized test fixture contain no raw envelope text, server name, capability, route, or endpoint sentinel.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Only Kitten's fixed bundled-MCP errors receive the approved failure classification.
- ACP and arbitrary text remain confined to the adapter boundary.
