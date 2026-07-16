---
status: pending
title: Admit concurrent authenticated MCP sockets per route
type: bugfix
complexity: high
---

# Task 02: Admit concurrent authenticated MCP sockets per route

## Overview

Replace false singleton-socket contention in the private MCP bridge with bounded
same-route admission. A valid `ask_user` and `agent_run` invocation from separate
child sockets must progress within the existing four-call capacity, while
disconnects affect only their owning calls and route invalidation remains global.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. MUST replace exclusive `Route.boundSocket` admission with private per-route membership while preserving one route per socket, capability authentication, generation fencing, strict frames, duplicate call-ID checks, the four-pending-call bound, and the 256-call route lifetime bound.
- 2. MUST admit independently authenticated same-route sockets until the existing pending-call capacity is full; the next call MUST receive the fixed `busy` outcome immediately and MUST NOT queue.
- 3. MUST settle or cancel only calls owned by a disconnected socket and leave other authorized calls and the route usable; a disconnected `agent_run.start` MUST NOT be replayed.
- 4. MUST retain whole-route cancellation, listener shutdown, endpoint removal, and fail-closed rejection on session replacement, conversation close, and controller disposal.
- 5. MUST retire the false `connection_stream_limit` admission behavior without relaxing cross-session or malformed-frame rejection.
</requirements>

## Subtasks

- [ ] 2.1 Replace singleton route socket ownership with bounded authenticated socket membership.
- [ ] 2.2 Preserve existing reservation, authorization, and exact terminal-frame behavior under multi-socket admission.
- [ ] 2.3 Isolate normal close and error settlement to the owning socket's pending calls.
- [ ] 2.4 Keep controller-driven route invalidation as the only whole-route teardown path.
- [ ] 2.5 Prove real-child mixed calls, saturation, disconnect recovery, and cross-session isolation.

## Implementation Details

See TechSpec sections “System Architecture”, “Core Interfaces”, “Data Models”,
and “Testing Approach”. Reuse the current generated MCP child and private local
IPC protocol; do not add a queue, persistent client connection, configuration,
shared capacity, durable history, or retry mechanism.

### Relevant Files

- `src/app/kittenMcpBridge.ts` — owns route admission, private endpoint lifecycle, pending calls, and bounded error frames.
- `src/app/kittenMcpBridge.test.ts` — contains the current competing-stream, saturation, lifecycle, malformed-frame, and authorization coverage to update.
- `test/askUserMcp.integration.test.ts` — exercises the generated child over real local IPC and protects route isolation.
- `src/agent/askUserMcp.ts` — opens one connection per invocation and defines the fixed child error envelope that must remain compatible.
- `src/app/controller.ts` — provides the targeted clarification cancellation and semantic control contract consumed by the bridge.

### Dependent Files

- `src/app/controller.test.ts` — validates controller-side semantic busy/unavailable behavior used by bridge dispatch.
- `src/telemetry/recorder.ts` — receives the controller-wired closed bridge category after bridge failures occur.
- `src/agent/acpTranslate.ts` — later classifies the unchanged fixed child error envelope; this task must not alter it.

### Related ADRs

- [ADR-001: Keep concurrent MCP admission controller-owned and bounded](adrs/adr-001.md) — preserves capability-derived authority and bounded resources.
- [ADR-003: Admit independently authenticated sockets within route capacity](adrs/adr-003.md) — selects per-route multi-socket admission and isolated disconnect handling.
- [ADR-004: Project closed MCP failures without replaying ambiguous work](adrs/adr-004.md) — forbids automatic replay after an ambiguous disconnect.

## Deliverables

- A private bridge that admits valid same-route child sockets up to the existing capacity.
- Per-socket disconnect settlement that keeps unrelated same-route work live.
- Preserved capacity, authorization, route-invalidation, and fixed-envelope behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for real-child mixed-work and session-isolation paths **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Two distinct authenticated sockets on one route can hold a pending `agent_run` and a pending `ask` concurrently, and both receive their own terminal result.
  - [ ] Four pending calls from distinct sockets are admitted; a fifth receives one immediate `busy` frame, creates no pending work, and a later call succeeds after capacity settles.
  - [ ] Closing or erroring one socket with a pending ask cancels only its clarification and leaves another same-route pending call and a new authenticated socket usable.
  - [ ] Closing a socket during `agent_run.start` does not close the route or replay the start; later same-route calls remain authorized.
  - [ ] Duplicate IDs, wrong capabilities, malformed frames, stale generations, and cross-route sockets remain rejected with their existing bounded outcomes.
- Integration tests:
  - [ ] The real generated child invokes `ask_user` and `agent_run` concurrently from one parent environment and both structured results settle without a false stream-limit error.
  - [ ] Two parent environments can run mixed calls concurrently but cannot poll, settle, or observe the other session's delegated child.
  - [ ] Session replacement and controller disposal remove the endpoint and make late child calls unavailable even after multi-socket admission.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The existing four-call route limit, not socket exclusivity, is the authoritative concurrency boundary.
- Same-session continuity and cross-session isolation are both proven with real local IPC coverage.
