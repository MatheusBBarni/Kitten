---
status: completed
title: Build verified managed-worktree provisioner
type: backend
complexity: high
---

# Task 03: Build verified managed-worktree provisioner

## Overview

Create the single app-owned Git lifecycle service that provisions verified child worktrees before any child session exists. It establishes the repository-local managed root, creates collision-safe branches/worktrees from committed parent state, and rolls back only artifacts created by a failed attempt.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add one injected app-layer provisioner with no controller, ACP, store, or UI mutation.
2. MUST require a canonical Git repository, attached branch, committed `HEAD`, and no submodules.
3. MUST use only `<repo-root>/.kitten/worktrees`, local exclusion metadata, and bounded opaque identifiers.
4. MUST verify repo, path containment, branch, and base SHA against authoritative Git worktree data before returning a binding.
5. MUST release reservations and roll back only positively owned clean artifacts on every pre-registration failure.
</requirements>

## Subtasks
- [x] Define injected command, filesystem, reservation, and bounded-result contracts.
- [x] Inspect the parent repository and prepare the private managed root.
- [x] Reserve and provision a unique branch/worktree from committed parent state.
- [x] Verify authoritative worktree identity and perform owned rollback on failure.
- [x] Add injected and temporary-real-repository creation coverage.

## Implementation Details

Create the service described in the TechSpec Git lifecycle section. Follow existing injected spawn and canonical containment patterns; do not wire it into the controller yet.

### Relevant Files
- `src/app/managedWorktree.ts` — new managed Git provisioner.
- `src/app/managedWorktree.test.ts` — colocated injected and real-Git lifecycle coverage.
- `src/config/gitBranch.ts` — reference for injected Git spawning only.
- `src/config/gitBranch.test.ts` — reference for temporary Git repository fixtures.
- `src/app/fileDiscovery.ts` — reference for canonical filesystem containment.

### Dependent Files
- `src/app/controller.ts` — later invokes verified provisioning before child registration.
- `src/app/managedWorktree.ts` — later gains reconciliation and cleanup operations.

### Related ADRs
- [ADR-001: Create managed worktrees only for spawned child sessions](adrs/adr-001.md) — managed-only boundary.
- [ADR-004: Allocate verified worktrees before child registration](adrs/adr-004.md) — repository-local allocation policy.

## Deliverables
- Injected managed-worktree provisioner with bounded failure reasons and owned rollback.
- Unit and temporary-real-Git tests with >=80% coverage **(REQUIRED)**.
- Integration tests proving parent checkout remains unchanged during sibling provisioning **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Reject non-repository, detached, submodule, root-conflict, and spawn-failure inputs with bounded reasons.
  - [x] Preserve pre-existing collision artifacts and roll back only artifacts created by the failed provision.
  - [x] Reject a Git-list verification mismatch without returning a binding.
- Integration tests:
  - [x] Two provisions in a temporary committed repository create distinct child branches/paths beneath `.kitten/worktrees` with matching base SHA.
  - [x] Local exclusion prevents the managed root from appearing as parent project work.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Successful provisioning returns only verified contained worktree paths.
- No failed provision can delete an unowned branch or path.
