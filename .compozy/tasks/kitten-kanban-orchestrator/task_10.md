---
status: pending
title: Add card-owned managed worktrees
type: backend
complexity: high
---

# Task 10: Add card-owned managed worktrees

## Overview

Implement desktop-owned card worktree bindings that survive fresh attempts and
preserve the trusted parent checkout. The service applies the existing safety
principles but owns a new card model and refuses unverified or unsafe cleanup.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Every card MUST have one desktop-owned binding and branch that persists across its attempts.
2. Bindings MUST be provisioned only beneath the canonical trusted repository in a desktop-controlled managed root and record baseline identity.
3. Provision and reconciliation MUST verify containment, non-symlink paths, authoritative Git worktree state, branch, baseline, and parent safety.
4. Missing, external, dirty, mismatched, or unverified bindings MUST fail closed with bounded worktree-unavailable reasons.
5. Fresh attempts MUST reuse the verified binding and MUST NOT mutate the trusted parent checkout.
6. Cleanup MUST be explicit and refuse live, dirty, unmerged, external, or unverified artifacts; review MUST not automatically push or remove worktrees.
</requirements>

## Subtasks

- [ ] 10.1 Define card binding, lifecycle, and bounded-unavailable contracts.
- [ ] 10.2 Verify trusted repository identity and managed-root containment.
- [ ] 10.3 Provision a new verified branch and worktree with a persisted baseline.
- [ ] 10.4 Reconcile and reuse existing card bindings across fresh attempts.
- [ ] 10.5 Persist binding lifecycle and implement refusal-first explicit cleanup.
- [ ] 10.6 Add temporary-repository safety and persistence coverage.

## Implementation Details

Follow the TechSpec Git managed worktrees integration point. The current
session-bound managed-worktree implementation is a behavioral reference, not a
model or ownership source for desktop.

### Relevant Files

- packages/desktop/src/worktrees/contracts.ts — card-owned binding models.
- packages/desktop/src/worktrees/gitWorktree.ts — injected Git/filesystem verification.
- packages/desktop/src/worktrees/gitWorktree.test.ts — temporary repository safety cases.
- packages/desktop/src/worktrees/cardWorktreeService.ts — lifecycle orchestration.
- packages/desktop/src/worktrees/cardWorktreeService.test.ts — binding lifecycle coverage.
- packages/desktop/src/worktrees/cardWorktreeProjection.ts — journal projection adapter.
- packages/desktop/src/worktrees/index.ts — constrained host export boundary.

### Dependent Files

- packages/tui/src/app/managedWorktree.ts — reference-only safety precedent.
- packages/desktop/src/attempts/runnableValidator.ts — future stable-worktree prerequisite.
- packages/desktop/src/host/recovery.ts — future retained-binding recovery consumer.

### Related ADRs

- [ADR-003: Establish the packages-only workspace before desktop delivery](adrs/adr-003.md) — desktop worktree ownership.
- [ADR-004: Persist desktop work as an append-only SQLite journal with projections](adrs/adr-004.md) — binding durability.

## Deliverables

- Card-owned, verified worktree lifecycle and durable binding projection.
- Bounded unsafe-state results and refusal-first cleanup behavior.
- Temporary-repository regression suite.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for provision, reopen, reconcile, and cleanup refusal **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Verify canonical contained worktree, unique branch, and parent checkout invariants.
  - [ ] Reject symlink, external, dirty, divergent, unmerged, gitlink, detached, and mismatched bindings.
  - [ ] Verify rollback removes only clean artifacts created by the failing provision.
- Integration tests:
  - [ ] Reopen a temporary SQLite projection and reuse the exact card binding on a fresh attempt.
  - [ ] Verify cleanup refuses live, dirty, unmerged, external, and unverified bindings.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- A fresh attempt reuses the card worktree without changing the parent checkout.
- No review or recovery path silently pushes or deletes a worktree.
