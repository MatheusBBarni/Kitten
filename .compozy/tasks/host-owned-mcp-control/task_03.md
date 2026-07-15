---
status: pending
title: Generalize the authenticated Kitten MCP bridge
type: backend
complexity: high
---

# Task 03: Generalize the authenticated Kitten MCP bridge

## Overview

Generalize the existing ask-user bridge into a Kitten-wide authenticated bridge that serves both bundled tool families through one capability-bound route. The bridge retains its current local transport hardening while injecting a narrowly typed control callback for `agent_run`.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. The bridge MUST retain one private endpoint and opaque capability per live session generation and derive the route only from that capability.
- 2. The local frame protocol MUST discriminate `ask` and `agent_run` calls while preserving all existing bounds, call-ID checks, and generic failures.
- 3. `agent_run` dispatch MUST invoke an injected `AgentRunControl` with the captured route and MUST NOT accept caller-supplied session or generation identity.
- 4. Replacement, close, connection failure, and disposal MUST invalidate matching routes and MUST preserve existing `ask_user` behavior.
</requirements>

## Subtasks

- [ ] 3.1 Rename and generalize the bridge service and its test suite for bundled MCP tools.
- [ ] 3.2 Add authenticated `agent_run` frame dispatch through an injected application control seam.
- [ ] 3.3 Preserve registration, declaration ordering, route replacement, and teardown behavior.
- [ ] 3.4 Cover rejected frames and stale routes without callback invocation or information disclosure.

## Implementation Details

Follow the TechSpec “System Architecture,” “Integration Points,” and “Controller Behavior” sections. Rename mechanically where practical, retain an optional unavailable default until controller control is supplied, and keep all MCP SDK types in `src/agent/`.

### Relevant Files
- `src/app/askUserBridge.ts` → `src/app/kittenMcpBridge.ts` — generalized private routes, framed dispatch, and capability lifecycle.
- `src/app/askUserBridge.test.ts` → `src/app/kittenMcpBridge.test.ts` — authentication, frame, route, and cleanup coverage.
- `src/app/controller.ts` — generalized bridge factory, declarations, and lifecycle injection seam.
- `src/app/controller.test.ts` — recording bridge/test-double updates and generated-declaration ordering regressions.

### Dependent Files
- `src/agent/agentRunMcp.ts` — supplies the validated agent-run request/result vocabulary.
- `src/agent/askUserMcp.ts` — existing ask-user behavior that must remain unchanged.
- `src/agent/kittenMcp.ts` — bundled child-side composition that consumes generated declarations.

### Related ADRs
- [ADR-001: Expose a bounded start-and-poll MCP surface](adrs/adr-001.md) — route-derived authority requirement.
- [ADR-003: Extend the authenticated Kitten MCP bridge with atomic bounded agent control](adrs/adr-003.md) — selects one shared authenticated route.

## Deliverables

- A generalized bridge module and migrated controller injection seam.
- Capability-derived `ask | agent_run` frame handling with route invalidation.
- Unchanged ask-user regression coverage plus agent-run bridge security coverage.
- Unit and local-IPC integration tests with 80%+ coverage.

## Tests

- Unit tests:
  - [ ] A valid `agent_run.start` frame gives the injected control the route captured from its capability and its ordered tasks.
  - [ ] A valid `agent_run.poll` frame gives the injected control only the requested child IDs and serializes its snapshots.
  - [ ] Malformed, oversized, wrong-kind, duplicate-call, and invalid-capability frames invoke no control callback and disclose no route, capability, parent, or task content.
  - [ ] Replacement, close, connection loss, and disposal reject a stale route while preserved ask-user calls retain their existing behavior.
- Integration tests:
  - [ ] User MCP declarations retain their configured order before one generated Kitten declaration for a live generation.
  - [ ] A competing stream on one route is rejected before either tool family is dispatched.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- One authenticated route safely serves both bundled tool families without caller-selected authority.
- Existing ask-user behavior and route cleanup remain intact.
