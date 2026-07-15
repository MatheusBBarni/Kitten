---
status: pending
title: Wire agent_run lifecycle composition and end-to-end coverage
type: backend
complexity: high
---

# Task 06: Wire agent_run lifecycle composition and end-to-end coverage

## Overview

Complete lifecycle wiring for the generalized generated MCP declaration and prove the feature through the real same-binary child and fake ACP providers. This task verifies that every live provider generation receives the correct private capability, visible children, and strict cleanup behavior without new UI or persistence.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. Every fresh, dynamic, and restored live controller generation MUST compose one generated bundled declaration after configured user MCP declarations.
- 2. Replacement, close, provider failure, restore reset, and disposal MUST invalidate only the matching route and MUST NOT restore ephemeral delegation authority.
- 3. Real stdio MCP integration MUST prove both bundled tools coexist while stdout remains protocol-only.
- 4. Fake-ACP integration MUST prove four-child lifecycle visibility, owner-scoped polling, provider isolation, attention mapping, and stale-route rejection.
</requirements>

## Subtasks

- [ ] 6.1 Complete generalized bridge/control composition in every controller lifecycle path.
- [ ] 6.2 Preserve declaration caching, user-server order, and generation-specific capabilities.
- [ ] 6.3 Expand same-binary stdio integration for both bundled MCP tools.
- [ ] 6.4 Exercise multi-provider fake-ACP child lifecycle and route invalidation behavior.

## Implementation Details

Follow the TechSpec “Integration Points,” “Testing Approach,” and “Technical Dependencies.” Reuse existing controller lifecycle cleanup paths and fake transport seams; this task proves composition and behavior rather than redefining schemas, bridge parsing, controller policy, or telemetry.

### Relevant Files
- `src/app/controller.ts` — generalized declaration/control composition across fresh, dynamic, restore, replacement, close, failure, and disposal paths.
- `src/app/controller.test.ts` — generation-specific declarations, route invalidation, and controller composition regressions.
- `test/askUserMcp.integration.test.ts` — real same-binary stdio, authenticated local IPC, and two-provider ordering coverage.
- `test/orchestration.integration.test.ts` — real controller plus fake-ACP lifecycle and polling coverage.

### Dependent Files
- `src/agent/kittenMcp.ts` — bundled child server that exposes both tools.
- `src/agent/agentRunMcp.ts` — strict public agent-run wire contract.
- `src/app/kittenMcpBridge.ts` — authenticated route registration and dispatch.
- `src/store/appStore.ts` — visible selection-neutral child registration.
- `test/mockAgent.ts` — reusable fake-agent integration harness.

### Related ADRs
- [ADR-001: Expose a bounded start-and-poll MCP surface](adrs/adr-001.md) — defines supervised start/poll behavior.
- [ADR-003: Extend the authenticated Kitten MCP bridge with atomic bounded agent control](adrs/adr-003.md) — requires one lifecycle-bound bridge and ephemeral authority.

## Deliverables

- Lifecycle-complete generalized MCP declaration and control wiring.
- Same-binary stdio and two-provider authenticated IPC integration evidence.
- Fake-ACP lifecycle coverage for visible children, status mapping, polling, and invalidation.
- Integration tests with 80%+ coverage.

## Tests

- Unit tests:
  - [ ] Fresh, dynamic, and restored generations each receive one generated declaration after all configured user MCP declarations.
  - [ ] Replacement, close, provider error, restore reset, and disposal invalidate only their matching routes and settle no stale callback.
- Integration tests:
  - [ ] A real stdio child lists `ask_user` and `agent_run`, executes an authenticated agent-run call, and produces protocol-only stdout.
  - [ ] Two concurrent provider sessions retain distinct capabilities, preserve user-server ordering, and cannot poll each other’s child IDs.
  - [ ] Fake ACP drives a four-child start through running, `needs_input`, finished, and failed snapshots visible in the normal workspace projection.
  - [ ] Replacing a parent generation makes the former route unavailable for both start and poll.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every live provider generation has one isolated generated control route with deterministic user MCP ordering.
- Delegated route authority remains ephemeral across lifecycle exits while child conversations remain normally visible.
