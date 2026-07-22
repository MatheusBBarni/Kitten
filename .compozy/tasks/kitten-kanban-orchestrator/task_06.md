---
status: completed
title: Scaffold Electrobun desktop host, typed RPC, renderer, and test harness
type: infra
complexity: high
---

# Task 06: Scaffold Electrobun desktop host, typed RPC, renderer, and test harness

## Overview

Create the desktop shell: Electrobun host lifecycle, one typed RPC schema, a
minimal React renderer, and an injected test harness. The shell exposes only
safe projection-shaped values and deliberately contains no board, persistence,
worktree, catalog, or attempt implementation yet.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Desktop dependencies MUST be exact-pinned under the workspace dependency policy.
2. One shared typed RPC schema MUST define bootstrap/query, command-result, and host-message envelopes with typed conflict and unavailable outcomes.
3. Host replies MUST contain projections only; ACP connections, filesystem handles, SQLite handles, Skill contents, worktree objects, and secrets MUST never cross RPC.
4. The renderer MUST communicate only through the typed RPC client and clean up subscriptions on teardown.
5. An injectable fake-window harness MUST prove host registration, message delivery, and teardown without a real desktop process.
</requirements>

## Subtasks

- [x] 6.1 Add desktop package metadata, pinned dependencies, and Electrobun configuration.
- [x] 6.2 Define shared RPC commands, results, and host messages.
- [x] 6.3 Create Bun host window and RPC lifecycle registration.
- [x] 6.4 Create minimal React renderer bootstrap from a safe snapshot.
- [x] 6.5 Add fake-window harness and typed host/renderer contract coverage.

## Implementation Details

Follow the TechSpec Typed Desktop RPC and Component Overview. This task creates
the boundary consumed by later host and renderer features; it does not create an
HTTP API.

### Relevant Files

- packages/desktop/package.json — desktop package and exact pins.
- bun.lock — reviewed workspace resolution.
- packages/desktop/electrobun.config.ts — desktop host configuration.
- packages/desktop/src/shared/rpc.ts — single typed schema.
- packages/desktop/src/main.ts — Bun host lifecycle.
- packages/desktop/src/renderer/main.tsx — projection-only renderer bootstrap.
- packages/desktop/test/desktopShell.test.ts — fake-window harness coverage.

### Dependent Files

- packages/desktop/src/persistence/eventJournal.ts — future host authority.
- packages/desktop/src/renderer/features/board/WorkflowBoard.tsx — future renderer consumer.
- packages/desktop/src/host/desktopRpc.ts — future command registration.

### Related ADRs

- [ADR-003: Establish the packages-only workspace before desktop delivery](adrs/adr-003.md) — desktop package boundary.
- [ADR-004: Persist desktop work as an append-only SQLite journal with projections](adrs/adr-004.md) — projection-only host boundary.

## Deliverables

- Pinned Electrobun desktop package and host/renderer bootstrap.
- Shared typed RPC schema with safe typed failures.
- Injectable desktop shell harness.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for host registration, message delivery, and teardown **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Discriminate typed bootstrap, conflict, and unavailable RPC results.
  - [x] Reject RPC payloads that expose privileged resources.
  - [x] Verify renderer imports no host implementation.
- Integration tests:
  - [x] Use a fake window to prove handler registration, bootstrap response, host message delivery, and teardown removal.
  - [x] Verify no HTTP listener is registered.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The renderer communicates exclusively through typed projection RPC.
- Host lifecycle is testable without a real desktop process.
