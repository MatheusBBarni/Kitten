---
status: pending
title: Reconcile bindings and safely clean retained worktrees
type: backend
complexity: high
---

# Task 04: Reconcile bindings and safely clean retained worktrees

## Overview

Extend the managed Git service with reconciliation and explicit non-force cleanup. Restored or retained worktrees become available only after fresh provenance verification; unsafe worktrees remain intact with bounded refusal reasons.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add pure-result reconciliation and cleanup operations to the existing managed Git service.
2. MUST reconcile canonical root, managed-root containment, worktree identity, branch, and base relationship without mutating Git state.
3. MUST require controller-supplied terminal/non-live ownership plus fresh provenance, clean state, and merged status before cleanup.
4. MUST refuse missing, external, dirty, unmerged, live-owned, not-managed, or unverifiable bindings without destructive commands.
5. MUST remove a verified worktree non-force before safe branch deletion and never merge or force-delete.
</requirements>

## Subtasks
- [ ] Define bounded reconciliation and cleanup result contracts.
- [ ] Reconcile persisted binding identity against filesystem and Git state.
- [ ] Revalidate safety conditions immediately before cleanup.
- [ ] Remove only clean merged managed worktrees using normal Git commands.
- [ ] Extend injected and real-Git safety coverage.

## Implementation Details

Extend the service from the TechSpec Git lifecycle section. Keep controller liveness checks and UI routing outside this task.

### Relevant Files
- `src/app/managedWorktree.ts` — extends the authoritative provisioner with reconcile/cleanup operations.
- `src/app/managedWorktree.test.ts` — extends lifecycle safety coverage.
- `src/config/gitBranch.ts` — reference for injected Git process seams.
- `src/app/fileDiscovery.ts` — reference for canonical containment behavior.

### Dependent Files
- `src/app/controller.ts` — later supplies terminal/liveness facts and consumes results.
- `src/persistence/runRecord.ts` — later supplies persisted binding identity.
- `src/ui/SessionsOverlay.tsx` — later presents bounded cleanup outcomes.

### Related ADRs
- [ADR-003: Persist managed bindings in versioned session records and reconcile on restore](adrs/adr-003.md) — requires fail-closed reconciliation.
- [ADR-005: Restrict cleanup to terminal child review and verify Git lifecycle in two layers](adrs/adr-005.md) — defines explicit safe cleanup.

## Deliverables
- Reconciliation and cleanup operations with bounded outcome codes.
- Unit and temporary-real-Git tests with >=80% coverage **(REQUIRED)**.
- Integration tests proving unsafe worktrees remain untouched **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Reconciliation returns available only for matching canonical managed provenance.
  - [ ] Missing, external, and verification-failed bindings produce no Git mutation.
  - [ ] Dirty, unmerged, live-owned, and not-managed cleanup inputs issue no remove/delete command.
  - [ ] Successful cleanup orders verification, non-force worktree removal, then safe branch deletion.
- Integration tests:
  - [ ] A retained managed worktree in a temporary repository reconciles successfully.
  - [ ] Clean merged cleanup succeeds while dirty and unmerged worktrees remain intact.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Unsafe cleanup cannot remove a worktree or branch.
- No cleanup result exposes raw Git output.
