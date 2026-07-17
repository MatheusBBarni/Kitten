---
status: completed
title: Generation-bound Context Pack bridge
type: backend
complexity: critical
---

# Task 06: Generation-bound Context Pack bridge

## Overview

Create a dedicated same-binary MCP surface for Context Builds. It must authorize every request against one parent session, child, generation, draft revision, workspace root, and closed operation set.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- The bridge MUST be distinct from kittenMcpBridge and MUST never advertise or inherit agent_run authority.
- Child mode MUST compose only scoped ask_user and Context Pack MCP tools; it MUST exclude shell, general Git, external MCP, agent control, seal, send, export, and approval.
- Every handler MUST re-authorize parent, child, generation, workspace, path, byte bounds, and expected revision; advertised tools alone are insufficient.
- The closed tool set MUST contain only read_draft, bounded read_workspace, and revision-fenced mutate_draft plus scoped ask_user.
- The bridge MUST dispose on child settlement, parent generation change, or denied launch, and late calls MUST fail without mutation.
</requirements>

## Subtasks

- [x] 6.1 Define strict MCP input/output schemas and scoped route contracts.
- [x] 6.2 Implement the dedicated Context Pack bridge and authorization facade.
- [x] 6.3 Add child-mode registration that composes only scoped ask_user and Context Pack tools.
- [x] 6.4 Register the same-binary child entry point without changing the mixed bridge.
- [x] 6.5 Test every forbidden operation, route mismatch, and cleanup race.

## Implementation Details

Follow the TechSpec closed MCP surface and ADR-004. Controller lifecycle orchestration remains outside this task; this bridge receives an already-established route and facade, then defends it on every request.

### Relevant Files

- src/app/contextPackBridge.ts — new generation/revision-bound authorization bridge.
- src/app/contextPackBridge.test.ts — direct handler and disposal coverage.
- src/agent/contextPackMcp.ts — new dedicated MCP registrar and schemas.
- src/agent/contextPackMcp.test.ts — exact tool-list/schema coverage.
- src/index.ts — same-binary Context Pack child mode registration.
- test/firstRunBoot.test.ts — child-mode boot and tool isolation coverage.

### Dependent Files

- src/app/controller.ts — later route registration and disposal owner.
- src/config/contextPackCapability.ts — closed explore-v2 evidence.
- src/app/contextPackMaterializer.ts — bounded workspace artifact facade.
- src/agent/kittenMcpBridge.ts — existing mixed bridge that must remain untouched.

### Related ADRs

- [ADR-004: Use a separate generation-bound Context Pack bridge for explore-v2](adrs/adr-004.md)
- [ADR-003: Keep Context Packs session-keyed and persist only manifests plus sealed bytes](adrs/adr-003.md)
- [ADR-001: Plan the full Context Packs contract with evidence-gated vertical delivery](adrs/adr-001.md)

## Deliverables

- Dedicated Context Pack MCP registrar and generation-bound bridge.
- Same-binary child mode with the exact closed tool set.
- Per-request authorization and lifecycle disposal behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for direct forbidden-operation rejection with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] tools/list contains only scoped ask_user plus read_draft, read_workspace, and mutate_draft with strict schemas.
  - [x] Parent, child, generation, revision, root, path, and byte mismatches are denied without store mutation.
  - [x] Expected-revision mutations succeed once and stale mutations preserve the newer draft.
  - [x] Disposal rejects all later reads and writes.
- Integration tests:
  - [x] Direct calls attempting agent_run, shell, general Git, external MCP, cross-session access, seal, send, export, or approval fail generically.
  - [x] Parent generation change and child settlement leave no callable route or live builder authority.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- A Context Build has only the documented bounded curation authority.
- No mixed MCP capability or late child call can cross the generation/session boundary.
