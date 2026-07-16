---
status: completed
title: Add protocol-free managed-worktree binding state
type: refactor
complexity: high
---

# Task 01: Add protocol-free managed-worktree binding state

## Overview

Add immutable managed-worktree binding state to sessions without introducing Git, ACP, or runtime references into the core. The controller needs one guarded store transition to publish reconciliation and cleanup outcomes while preserving the registry's ephemeral delegation model.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST define immutable protocol-free binding, availability, and bounded-reason values from the TechSpec Core Interfaces section.
2. MUST preserve an optional binding from `SessionSeed` through `SessionState`, including session start/reset paths.
3. MUST add one controller-published store transition that validates the binding owner and is a semantic no-op for invalid or unchanged input.
4. MUST preserve structural sharing and keep `DelegationState` separate, empty-on-restore, and free of binding ownership.
</requirements>

## Subtasks
- [ ] Define the managed-worktree contracts in the session domain model.
- [ ] Carry optional binding state through seed creation and ACP-session reset.
- [ ] Add the guarded immutable store publication transition.
- [ ] Preserve ordinary and delegated session behavior without reconstructed ownership.
- [ ] Add focused core and store coverage for no-op and structural-sharing behavior.

## Implementation Details

Modify the protocol-free session and store seams described in the TechSpec Data Models section. Keep all lifecycle discovery and command execution outside this task.

### Relevant Files
- `src/core/types.ts` — owns `SessionSeed`, `SessionState`, and protocol-free domain contracts.
- `src/core/sessionReducer.ts` — creates and resets normalized session state.
- `src/store/appStore.ts` — owns immutable session insertion, replacement, and controller-published state.
- `src/core/types.test.ts` — colocated domain contract coverage.
- `src/core/sessionReducer.test.ts` — session reset and seed-to-state coverage.
- `src/store/appStore.test.ts` — dynamic, delegated, and restore store flows.

### Dependent Files
- `src/store/selectors.ts` — later projects binding state for UI consumers.
- `src/app/controller.ts` — later publishes verified, reconciled, and cleanup binding results.
- `src/persistence/runRecord.ts` — later serializes a strict subset of binding identity.

### Related ADRs
- [ADR-003: Persist managed bindings in versioned session records and reconcile on restore](adrs/adr-003.md) — defines immutable persisted review identity.
- [ADR-004: Allocate verified worktrees before child registration](adrs/adr-004.md) — keeps Git I/O outside core/store.

## Deliverables
- Immutable managed-worktree session binding contracts and guarded store transition.
- Colocated unit and store-flow tests with >=80% coverage **(REQUIRED)**.
- Integration coverage for delegated and restored seed flows **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] A managed seed creates state with the same binding while an ordinary seed has none.
  - [ ] Session start/reset changes ACP state without removing a binding.
  - [ ] Unknown session, mismatched owner, and semantic-repeat publications are complete no-ops.
- Integration tests:
  - [ ] Delegated insertion and session replacement retain binding state while replacement clears delegation ownership.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Only the addressed session changes for a valid publication.
- Core/store imports remain free of Git, ACP, and runtime lifecycle work.
