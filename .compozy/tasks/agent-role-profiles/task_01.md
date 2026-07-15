---
status: completed
title: Add the closed explore policy and immutable child snapshot contract
type: backend
complexity: medium
---

# Task 01: Add the closed explore policy and immutable child snapshot contract

## Overview

Create the protocol-free contract that defines the only V1 child role, its restrictions, finite limits, confirmed display values, and closed denial vocabulary. This gives later layers one immutable launch-time value without introducing a configurable role system or leaking provider/runtime state into core.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a pure, protocol-free `explore` policy contract with exactly the V1 restrictions: read-only filesystem, no shell, no external MCP, no agent control, scoped `ask_user` allowed, and depth zero.
- MUST model finite positive per-parent and global capacity limits as policy input without adding user configuration, defaults, or mutable policy storage.
- MUST expose an immutable snapshot containing only role, restrictions, limits, nonblank attestation version, and protocol-free confirmed provider/model/effort display values.
- MUST use a closed typed denial union for unsupported provider, missing or stale attestation, ineligible or closing parent, capacity exhaustion, and startup failure; arbitrary or raw strings are forbidden.
- MUST remain free of ACP, configuration I/O, React, telemetry, and persistence imports.
</requirements>

## Subtasks
- [ ] 1.1 Define the fixed `explore` restriction and capacity value contracts in the core layer.
- [ ] 1.2 Define immutable accepted-snapshot and typed launch-decision contracts.
- [ ] 1.3 Validate role, restriction, capacity, attestation-version, and confirmed-display inputs deterministically.
- [ ] 1.4 Export only protocol-free values for later core, store, and controller consumers.
- [ ] 1.5 Add exhaustive colocated tests for valid and rejected policy inputs.

## Implementation Details

Create the pure contract described in TechSpec sections “Core Interfaces” and “Data Models.” Keep policy construction and validation deterministic, return typed decisions instead of throwing raw runtime details, and leave all reducer attachment, runtime attestation, UI, and telemetry work to their owning tasks.

### Relevant Files
- `src/core/explorePolicy.ts` — new pure closed policy, snapshot, and denial contract.
- `src/core/explorePolicy.test.ts` — new colocated deterministic validation and immutability tests.
- `src/core/types.ts` — existing `ProviderKind` and `SessionId` types available to the protocol-free contract.
- `src/core/orchestration.ts` — later consumer of accepted snapshots; preserve its pure reducer boundary.

### Dependent Files
- `src/core/types.ts` — later snapshot attachment imports this contract without introducing config/controller types.
- `src/core/orchestration.ts` — later registration will retain accepted snapshots through lifecycle transitions.
- `src/store/appStore.ts` — later atomic registration will store only accepted snapshots.
- `src/config/exploreCapability.ts` — later verifier maps runtime evidence into this core contract.

### Related ADRs
- [ADR-003: Resolve Explore Policy in Core and Snapshot It on Registration](adrs/adr-003.md) — establishes core ownership and immutable launch facts.
- [ADR-004: Gate Explore Launches on Provider-Specific Capability Attestation](adrs/adr-004.md) — constrains the typed denial vocabulary.
- [ADR-006: Verify the Explore Contract Through Layered Tests](adrs/adr-006.md) — requires pure invariant coverage.

## Deliverables

- New pure `src/core/explorePolicy.ts` contract with fixed restrictions, finite-limit validation, immutable snapshot construction, and closed denial reasons.
- New colocated unit suite covering every accepted and rejected policy case.
- A public protocol-free type surface consumable without configuration or ACP imports.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration-boundary tests for the public core export surface **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Valid exact restriction set produces an eligible immutable snapshot with `ask_user` enabled and all prohibited capabilities disabled.
  - [ ] Blank attestation version, invalid role, changed restriction, zero/negative/non-finite capacity, and malformed confirmed display values return a closed denial without mutation.
  - [ ] Every denial reason is a known enum value and no arbitrary string reason can be constructed through the public helper.
  - [ ] Repeated evaluation of identical input is deterministic and preserves caller-owned nested references.
- Integration tests:
  - [ ] A core consumer imports the policy contract without importing ACP, configuration, React, telemetry, or persistence modules.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The core has one fixed `explore` policy contract and no configurable role-profile mechanism.
- No policy value can carry task text, paths, raw errors, ACP ids, or provider recipe data.
