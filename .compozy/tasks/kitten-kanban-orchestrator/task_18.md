---
status: pending
title: Add interrupted-attempt recovery, review disposition, and layered acceptance gates
type: backend
complexity: high
---

# Task 18: Add interrupted-attempt recovery, review disposition, and layered acceptance gates

## Overview

Finish the desktop lifecycle with honest startup interruption recovery, explicit
human review disposition, content-free diagnostics, and layered acceptance
evidence. This is production recovery/review work as well as final integration
coverage; it never presents a live ACP session as restored.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Startup MUST atomically append one terminal interrupted outcome for every unclosed live attempt, retain all evidence, and start no ACP work automatically.
2. Recovery MUST be idempotent, leave terminal attempts untouched, preserve Workflow Stage, clear only the obsolete live lock, and never auto-complete a card.
3. A later attempt MUST use normal fresh-start validation, retain the card worktree and prior evidence, and never reuse the interrupted ACP session.
4. Only a version-fenced explicit reviewCard command from ready_for_review MUST persist a review disposition and change a card to completed.
5. Review and recovery MUST NOT push, open a pull request, merge, deploy, remove a worktree, or complete automatically.
6. Layered gates MUST cover domain/projection, SQLite, RPC, ACP/ask_user, worktree, desktop smoke, and relocated Cockpit compatibility without leaking content into diagnostics.
</requirements>

## Subtasks

- [ ] 18.1 Add transactional startup recovery for unclosed attempt projections.
- [ ] 18.2 Expose honest interruption history and new-attempt eligibility.
- [ ] 18.3 Persist version-fenced human review disposition and completion semantics.
- [ ] 18.4 Add content-free recovery and review diagnostics.
- [ ] 18.5 Add SQLite, fake-ACP, ask_user, and worktree recovery/review coverage.
- [ ] 18.6 Add desktop smoke and CI/package layered acceptance gates.

## Implementation Details

Follow the TechSpec Testing Approach, Monitoring and Observability, and final
build-order gate. The implementation must retain evidence instead of simulating
session restoration or publishing work.

### Relevant Files

- packages/desktop/src/host/recovery.ts — startup interruption transaction.
- packages/desktop/src/host/reviewDisposition.ts — explicit review persistence.
- packages/desktop/src/host/desktopCoordinator.ts — lifecycle integration.
- packages/desktop/test/recoveryReview.integration.test.ts — recovery/review evidence.
- packages/desktop/test/desktopSmoke.integration.test.ts — end-to-end desktop smoke.
- packages/desktop/package.json — layered desktop scripts.
- .github/workflows/ci.yml — final CI invocation.

### Dependent Files

- packages/desktop/src/persistence/eventJournal.ts — immutable recovery/review events.
- packages/desktop/src/attempts/attemptCoordinator.ts — fresh later attempt boundary.
- packages/desktop/src/worktrees/cardWorktreeService.ts — retained binding invariants.

### Related ADRs

- [ADR-001: Constrain V1 to a linear governed workflow with queued active-run input](adrs/adr-001.md) — governed progression.
- [ADR-002: Make Attention Blockers the V1 supervision priority](adrs/adr-002.md) — preserved answer-first evidence.
- [ADR-004: Persist desktop work as an append-only SQLite journal with projections](adrs/adr-004.md) — recovery/review evidence.
- [ADR-005: Own queued follow-ups and Attention Blockers in the desktop attempt coordinator](adrs/adr-005.md) — retained queue/blocker lifecycle.
- [ADR-007: Stage the Cockpit workspace relocation behind compatibility gates](adrs/adr-007.md) — final Cockpit compatibility gate.

## Deliverables

- Idempotent interruption recovery and explicit review disposition behavior.
- Content-free local recovery/review diagnostics.
- Layered desktop and relocated Cockpit acceptance suite.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for recovery, review, ACP, ask_user, worktree, RPC, and smoke flows **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Interrupt only non-terminal attempts exactly once and preserve stage without auto-completion.
  - [ ] Reject stale/wrong-state review and require an explicit review disposition for completion.
  - [ ] Assert recovery/review diagnostics contain no prompt, transcript, Skill, path, or credential content.
- Integration tests:
  - [ ] Restart running and needs-attention fixtures, retain context/transcript/blocker/queue evidence, clear live lock, and start no ACP work.
  - [ ] Start a later attempt and prove distinct session plus retained card worktree.
  - [ ] Reject stale blocker route after recovery and dispatch neither answer nor queued follow-up automatically.
  - [ ] Prove final success reaches ready_for_review and only reviewCard completes without Git publication/removal operations.
  - [ ] Run blank board through configured Skill, blocker outcome, confirmed follow-up, review, and no-publication desktop smoke.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Restarted desktop state is honest, replayable, and never claims session resumption.
- Completion always has explicit review evidence and zero automatic publication actions.
