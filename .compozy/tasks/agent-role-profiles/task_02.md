---
status: completed
title: Reserve and release explore capacity atomically in delegation state
type: backend
complexity: high
---

# Task 02: Reserve and release explore capacity atomically in delegation state

## Overview

Make `explore` capacity a reducer and store invariant instead of a controller preflight. An accepted starting child must reserve a slot in the same state transition that makes it visible, while a valid terminal lifecycle transition releases that slot exactly once.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST attach only an accepted immutable `ExplorePolicySnapshot` to delegated-child registration.
- MUST admit or deny capacity synchronously in the reducer/store registration path before any asynchronous child startup occurs.
- MUST count `starting`, `running`, and `needs_input` children as occupied while excluding terminal snapshots even before their visible record is removed.
- MUST enforce both per-parent and global finite limits while preserving existing nesting, duplicate, generation, and parent-closing rejections.
- MUST return a closed capacity denial with zero store/session/workspace mutation when admission fails.
- MUST release capacity only through identity-valid terminal lifecycle transitions and never release it a second time on removal or duplicate publication.
</requirements>

## Subtasks
- [x] 2.1 Extend delegated-child registration to carry an accepted policy snapshot.
- [x] 2.2 Add pure occupancy and capacity-admission behavior to delegation transitions.
- [x] 2.3 Commit accepted child session, workspace, snapshot, and reservation as one store update.
- [x] 2.4 Preserve release behavior across failed, cancelled, finished, parent-close, and stale-event paths.
- [x] 2.5 Add reducer and store tests for caps, races, no-ops, and cleanup.

## Implementation Details

Follow TechSpec sections “Data Models,” “Impact Analysis,” and “Development Sequencing.” Extend the existing flat delegation reducer and AppStore registration seam; do not add queues, background reconciliation, a second mutable counter, persistence, or controller-owned capacity state.

### Relevant Files
- `src/core/types.ts` — delegated child snapshot and registration event definitions.
- `src/core/orchestration.ts` — authoritative pure registration, status transition, and removal behavior.
- `src/core/orchestration.test.ts` — existing lifecycle, no-op identity, and terminal-state test conventions.
- `src/store/appStore.ts` — atomic delegated session, workspace, and reducer commit seam.
- `src/store/appStore.test.ts` — subscription and no-mutation assertions for store commits.

### Dependent Files
- `src/app/controller.ts` — consumes typed admission results before connection creation and relies on terminal cleanup.
- `src/app/controller.test.ts` — later tests startup, teardown, and generation-fenced release behavior.
- `src/store/selectors.ts` — later presentation reads immutable policy-bearing child snapshots.
- `test/orchestration.integration.test.ts` — integration consumer of flat delegated lifecycle semantics.

### Related ADRs
- [ADR-003: Resolve Explore Policy in Core and Snapshot It on Registration](adrs/adr-003.md) — requires immutable snapshots at registration.
- [ADR-005: Reserve Explore Capacity Atomically at Child Registration](adrs/adr-005.md) — defines admission and release invariants.
- [ADR-006: Verify the Explore Contract Through Layered Tests](adrs/adr-006.md) — requires pure and store-level proof.

## Deliverables

- Reservation-aware delegated-child registration and terminal-release behavior in core state.
- Atomic AppStore admission that never creates partial child/session/workspace state on denial.
- Reducer and store test coverage for per-parent/global capacity, terminal release, and stale lifecycle safety.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for registration and lifecycle capacity behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Per-parent admission accepts exactly the configured number of `starting` children and rejects the next request with an unchanged state reference.
  - [x] Global admission rejects a child when two parents collectively consume the global limit even if each parent remains below its local limit.
  - [x] `starting`, `running`, and `needs_input` consume a slot; valid `finished`, `failed`, and `cancelled` transitions free it while terminal snapshots remain inspectable.
  - [x] Wrong generation, wrong parent, illegal transition, duplicate terminal publication, and child removal do not release an occupied slot.
  - [x] A closing parent rejects registration even when another child terminalizes during the close flow.
- Integration tests:
  - [x] An accepted AppStore registration emits one commit containing the session, background workspace entry, policy snapshot, and reservation while preserving parent focus.
  - [x] A capacity denial emits no commit and creates no session, workspace entry, or delegated child.
  - [x] Terminal publication releases admission once, and later visible-child removal does not change capacity again.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- No concurrent registration path can exceed either configured capacity limit.
- Capacity denial leaves the full AppStore state unchanged.
