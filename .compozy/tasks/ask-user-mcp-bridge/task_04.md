---
status: pending
title: Build the session-bound authenticated local IPC bridge
type: backend
complexity: high
---

# Task 04: Build the session-bound authenticated local IPC bridge

## Overview

Create the controller-owned `AskUserBridge` service that registers one private route per session generation and translates authenticated child-process calls into coordinator-backed clarification requests. The service is the security boundary that derives ownership from a capability and never accepts a session identity from the MCP caller.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. The bridge MUST create an unguessable capability and private local endpoint for each registered session generation: a mode-0700 temporary Unix-domain-socket directory on POSIX and a unique named pipe on Windows, with no TCP fallback.
- 2. IPC callers MUST authenticate with the capability; session ID and generation MUST be derived only from the registration.
- 3. JSONL frames MUST be capped at 64 KiB and forms/concurrent calls MUST be bounded; malformed JSON, duplicate call IDs, stale, and unauthorized messages MUST fail closed without revealing private route details.
- 4. Registration replacement, close, provider failure, and disposal MUST cancel pending requests and release endpoint resources.
</requirements>

## Subtasks

- [ ] 4.1 Define the bridge registration and generated-server declaration contract.
- [ ] 4.2 Provide authenticated, bounded local request/response routing.
- [ ] 4.3 Connect accepted forms to the controller clarification request-handle boundary.
- [ ] 4.4 Emit only bounded reason enums for route-registration and child-connection failures, with no route or interaction content.
- [ ] 4.5 Release routes and settle pending calls on all lifecycle exits.

## Implementation Details

Add a narrowly scoped app-layer service; it must not import MCP SDK types. See the TechSpec “System Architecture,” “Local IPC and lifecycle,” and “Known Risks” sections.

### Relevant Files
- `src/app/askUserBridge.ts` — new controller-owned endpoint, capability, and route registry.
- `src/app/askUserBridge.test.ts` — new deterministic endpoint, authorization, and cleanup coverage.

### Dependent Files
- `src/app/controller.ts` — supplies session-generation lifecycle hooks and clarification request entrypoint.
- `src/agent/askUserMcp.ts` — acts as the authenticated child IPC client.
- `src/core/types.ts` — provides normalized forms and terminal outcomes.

### Related ADRs
- [ADR-001: Scope the provider-independent clarification bridge as a live-generation V1](adrs/adr-001.md) — defines live-generation settlement and privacy boundary.
- [ADR-003: Use a controller-owned bridge with per-session authenticated local IPC](adrs/adr-003.md) — defines ownership, endpoint, and capability model.

## Deliverables

- New app-layer bridge service with per-generation route registration and generated MCP declaration data.
- Authenticated bounded JSONL local IPC request/response handling.
- Route cancellation and endpoint cleanup behavior.
- Content-free registration and child-connection failure telemetry.
- Unit and local-IPC integration tests with 80%+ coverage.

## Tests

- Unit tests:
  - [ ] Unknown, malformed, and invalid-capability requests fail without a session or capability disclosure.
  - [ ] A stale generation cannot route a form after replacement.
  - [ ] Duplicate call IDs and oversized frames are rejected before clarification queueing.
  - [ ] One route cannot settle another route’s request.
  - [ ] Registration and connection failures emit only their fixed reason enum, never endpoint, capability, request, session, or form content.
- Integration tests:
  - [ ] A valid local client receives the submitted structured outcome from a fake coordinator entrypoint.
  - [ ] Route replacement, session close, and bridge disposal cancel a pending client call and remove the endpoint.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- No bridge caller can choose or infer another Kitten session through IPC input.
- Every route owns only its live generation and releases all resources at teardown.
