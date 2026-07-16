---
status: completed
title: Implement route-authorized batch start and poll
type: backend
complexity: high
---

# Task 05: Implement route-authorized batch start and poll

## Overview

Implement the controller-owned `AgentRunControl` service that turns an authenticated route into visible delegated child sessions and bounded status snapshots. It separates the UI’s selected-parent action adapter from capability-authorized control while keeping all runtime ownership inside the controller.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. The UI adapter MUST retain its selected-visible-parent guard, while `AgentRunControl` MUST accept only bridge-derived parent and generation routes.
- 2. `start` MUST preflight the complete request before creating IDs, sessions, registrations, runtimes, or prompts and MUST accept at most four children.
- 3. Accepted children MUST register as normal background conversations before concurrent startup; an individual startup failure MUST become only that child’s visible terminal failure.
- 4. `poll` MUST fail as a whole unless every explicit child ID is unique, current, and owned by the route parent and generation, and MUST return snapshots in requested order.
</requirements>

## Subtasks

- [x] 5.1 Factor the UI launch adapter from a route-authorized internal control service.
- [x] 5.2 Validate all start preconditions before any child-side effect.
- [x] 5.3 Register accepted children visibly and start them concurrently with existing lifecycle publication.
- [x] 5.4 Return owner- and generation-scoped poll snapshots with no partial disclosure.
- [x] 5.5 Exercise UI, route, lifecycle, and failure boundaries through controller tests.

## Implementation Details

Follow the TechSpec “Core Interfaces,” “Controller Behavior,” and “Data Models.” Consume the existing delegation projection and generation-fenced publication helpers; do not add lifecycle state, MCP types, persistence, nested launch, wait, cancellation, steering, or interaction response semantics.

### Relevant Files
- `src/app/controller.ts` — route-authorized control, UI adapter, lifecycle publication, and runtime ownership.
- `src/app/controller.test.ts` — injected connection, ID, bridge, clock, and delegated-launch test seams.

### Dependent Files
- `src/app/kittenMcpBridge.ts` — passes the authenticated route and invokes controller control.
- `src/store/appStore.ts` — performs selection-neutral visible child registration.
- `src/core/orchestration.ts` — existing protocol-free delegation snapshots and transition rules.
- `src/app/actions.ts` — user-facing action facade whose fail-soft behavior must remain intact.

### Related ADRs
- [ADR-001: Expose a bounded start-and-poll MCP surface](adrs/adr-001.md) — defines V1 operations and failure scope.
- [ADR-003: Extend the authenticated Kitten MCP bridge with atomic bounded agent control](adrs/adr-003.md) — defines atomic preflight and detached parallel startup.

## Deliverables

- Controller-owned route-authorized start and poll controls.
- Preserved UI focus policy and selection-neutral background child registration.
- Atomic preflight, concurrent child startup, and owner-scoped poll behavior.
- Unit and controller integration tests with 80%+ coverage.

## Tests

- Unit tests:
  - [x] An invalid batch with an unready, stale, closing, recursive, duplicate, empty, or fifth task creates no child ID, session, registration, runtime, or prompt.
  - [x] A valid four-child route request registers four visible background children before concurrent startup begins.
  - [x] One startup or initial-prompt failure terminalizes only its child as `failed` while accepted siblings remain visible.
  - [x] A route-authorized background-parent launch preserves selection, while direct UI launch still rejects a non-selected parent.
  - [x] Poll rejects unknown, stale, cross-parent, cross-generation, duplicate, and empty ID lists without partial snapshots.
  - [x] Poll returns requested-order snapshots with `needs_input` and optional terminal timestamp behavior unchanged.
- Integration tests:
  - [x] Parent replacement invalidates the prior route so it cannot start or poll children for the replacement generation.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Controller remains the only owner of child runtimes and route-authorized calls cannot select another parent.
- Each accepted child is visible and attributable before any asynchronous startup outcome occurs.
