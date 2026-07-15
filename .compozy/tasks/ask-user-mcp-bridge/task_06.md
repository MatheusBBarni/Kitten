---
status: completed
title: Provision the bridge per session and prove end-to-end lifecycle behavior
type: backend
complexity: critical
---

# Task 06: Provision the bridge per session and prove end-to-end lifecycle behavior

## Overview

Integrate generated bridge registrations into every fresh, restored, and dynamically created eligible session without reordering user MCP servers. Prove the complete provider-to-cockpit-to-provider behavior with the real spawned child, fake ACP agents, the existing controller/UI seams, and all high-risk lifecycle exits.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. Every eligible fresh, restored, and dynamic session MUST receive a distinct generated bridge declaration after the resolved user MCP declarations, preserving user order.
- 2. Registration MUST exist before ACP session creation and be invalidated on replacement, close, provider failure, and controller disposal.
- 3. The automated gate MUST spawn the real child mode, use real local IPC, and prove same-turn continuation through a fake ACP agent.
- 4. Concurrent sessions MUST never cross-route; submitted, skipped, timed_out, cancelled, stale, duplicate, and child-exit paths MUST settle safely.
</requirements>

## Subtasks

- [ ] 6.1 Compose the generated bridge declaration into each controller session-open path.
- [ ] 6.2 Tie bridge registration invalidation to every runtime lifecycle path.
- [ ] 6.3 Add the real spawned-child, fake-ACP end-to-end harness.
- [ ] 6.4 Prove multi-session routing, user MCP order, terminal outcomes, and teardown behavior.

## Implementation Details

Use the TechSpec “ACP session provisioning,” “Testing Approach,” and “Development Sequencing” sections. This task owns production controller composition plus the final integration gate; it is not a test-only task.

### Relevant Files
- `src/app/controller.ts` — owns fresh, restore, dynamic-session, close, failure, and disposal lifecycle paths.
- `src/app/controller.test.ts` — records supplied MCP server lists and exercises lifecycle seams.
- `test/mockAgent.ts` — exposes fake ACP session creation and received MCP declarations.
- `test/askUserMcp.integration.test.ts` — new real-child, real-IPC, fake-ACP end-to-end coverage.

### Dependent Files
- `src/app/askUserBridge.ts` — supplies generated per-session registrations and cancellation.
- `src/agent/askUserMcp.ts` — runs the real spawned MCP child.
- `src/ui/ClarificationPrompt.tsx` — renders the final structured operator interaction.
- `src/config/mcpResolver.ts` — remains the user-server resolution boundary whose order must be preserved.

### Related ADRs
- [ADR-001: Scope the provider-independent clarification bridge as a live-generation V1](adrs/adr-001.md) — requires same-run continuation and bounded live-generation reliability.
- [ADR-003: Use a controller-owned bridge with per-session authenticated local IPC](adrs/adr-003.md) — requires per-session registration and lifecycle cleanup.
- [ADR-004: Define a bounded multi-field contract with a Kitten-owned five-minute timeout](adrs/adr-004.md) — requires all terminal outcomes and bounded form behavior.

## Deliverables

- Controller composition that preserves `user MCP servers..., generated bridge` for every eligible session path.
- Lifecycle invalidation for bridge registrations and pending calls.
- Real spawned-child/fake-ACP end-to-end integration suite.
- Controller and end-to-end tests with 80%+ coverage of changed behavior.

## Tests

- Unit tests:
  - [ ] Fresh, restored, and dynamically created sessions receive user servers in original order followed by their own bridge declaration.
  - [ ] Session replacement and close invalidate only the affected bridge registration.
  - [ ] Provider failure and controller disposal cancel the affected pending bridge interaction exactly once.
- Integration tests:
  - [ ] A fake agent calls the real spawned `ask_user` child, the mounted cockpit accepts an answer, and the same prompt turn continues.
  - [ ] Two concurrent fake sessions receive only their own submitted response while user MCP order remains stable.
  - [ ] Explicit skip, five-minute timeout under an injected clock, Escape cancellation, stale reply, duplicate reply, child exit, close, replacement, and disposal all settle safely.
  - [ ] Manual: a built-in Codex session calls `ask_user`, an operator answers in Kitten, and that same turn continues; record the observed outcome in the task completion evidence.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every eligible session gets one isolated bridge without user MCP reordering.
- The real process boundary and same-turn continuation are proven automatically before manual Codex smoke testing.
