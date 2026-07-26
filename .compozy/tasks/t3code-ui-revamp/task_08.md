---
status: completed
title: Gate review readiness and approval on current evidence
type: backend
complexity: high
---

# Task 08: Gate review readiness and approval on current evidence

## Overview

Move trustworthy evidence into the final-stage and approval lifecycle boundary.
A card becomes reviewable only after evidence capture commits, and approval
completes that card only after the bound worktree still reproduces the reviewed
digest.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Successful final-stage completion MUST capture and commit valid evidence before publishing `ready_for_review`.
2. Capture MUST bind the exact board, card/version, attempt/generation, worktree binding, Git identities, policy, and digest.
3. Missing, stale, unsafe, unsupported, oversized, incomplete, or concurrently changed evidence MUST leave the card non-reviewable with a typed recovery reason.
4. Approval MUST require the full evidence precondition and a fresh digest recomputation.
5. Evidence, journal reference, readiness transition, approval disposition, and completion MUST use guarded atomic commits appropriate to each lifecycle boundary.
6. Duplicate approval commands MUST be idempotent; stale preconditions MUST append no disposition.
7. Approval MUST NOT push, open a pull request, merge, deploy, publish, or clean up the worktree.
</requirements>

## Subtasks

- [ ] 8.1 Insert evidence capture before the final-stage review-ready transition.
- [ ] 8.2 Fence capture against card, attempt, generation, worktree, and mutation races.
- [ ] 8.3 Expose typed non-reviewable evidence outcomes and retry guidance.
- [ ] 8.4 Require complete evidence preconditions for approval.
- [ ] 8.5 Revalidate the current digest immediately before disposition.
- [ ] 8.6 Commit approval and card completion atomically and idempotently.
- [ ] 8.7 Add lifecycle, SQLite, Git, restart, and external-side-effect regression coverage.

## Implementation Details

Follow the TechSpec **Review-evidence capture** and **Review disposition** data
flows. Reuse the canonical evidence service for both capture and revalidation;
do not introduce a second digest implementation in the coordinator or review
service.

### Relevant Files

- `packages/desktop/src/attempts/attemptCoordinator.ts` — final-stage success and readiness admission.
- `packages/desktop/src/host/reviewEvidence.ts` — capture and current-worktree revalidation.
- `packages/desktop/src/host/reviewDisposition.ts` — evidence-bound approval.
- `packages/desktop/src/host/reviewDisposition.test.ts` — approval and rejection coverage.
- `packages/desktop/test/recoveryReview.integration.test.ts` — worktree, persistence, restart, and lifecycle integration.

### Dependent Files

- `packages/desktop/src/persistence/eventJournal.ts` — atomic lifecycle/evidence/disposition persistence.
- `packages/desktop/src/shared/rpc.ts` — approval preconditions and typed failures.

### Related ADRs

- [ADR-001: Adopt a T3 Code-Inspired Supervision Loop While Preserving Kitten's Workflow Model](adrs/adr-001.md) — evidence-bound human completion.
- [ADR-002: Make Blocked Work and Evidence-Bound Review First-Class](adrs/adr-002.md) — fail-closed review gate.
- [ADR-004: Persist Immutable Review Evidence and Page Diffs by File](adrs/adr-004.md) — primary evidence binding and revalidation decision.

## Deliverables

- Evidence-gated final-stage readiness and approval lifecycle.
- Atomic, idempotent, current-evidence completion behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for final-stage capture, stale rejection, restart, and side-effect boundaries **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Enter `ready_for_review` only after valid evidence commits.
  - [ ] Keep missing, stale, unsafe, unsupported, oversized, or incomplete evidence non-reviewable.
  - [ ] Roll back evidence/reference/readiness after card or worktree mutation during capture.
  - [ ] Complete a card only with matching card, attempt, generation, binding, evidence ID, and digest.
  - [ ] Reject every stale precondition without a disposition.
  - [ ] Reject legacy review-ready cards that have no bound evidence.
  - [ ] Treat an exact duplicate approval command idempotently.
- Integration tests:
  - [ ] Capture from an isolated Git worktree before publishing final-stage readiness.
  - [ ] Leave no partial review-ready state after an injected SQLite failure.
  - [ ] Reject approval after tracked, dirty, or eligible untracked content changes.
  - [ ] Reopen SQLite and approve only when the worktree still reproduces the digest.
  - [ ] Verify approval completes only the card and performs no external delivery or cleanup.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Zero stale or ambiguous review decisions can complete a card.
- Every accepted approval identifies the exact evidence the operator reviewed.
