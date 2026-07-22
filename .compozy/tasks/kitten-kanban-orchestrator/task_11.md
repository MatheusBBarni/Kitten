---
status: completed
title: Add readiness, runnable validation, global scheduler, Run Context, and fresh ACP startup
type: backend
complexity: critical
---

# Task 11: Add readiness, runnable validation, global scheduler, Run Context, and fresh ACP startup

## Overview

Add the desktop attempt admission boundary: actionable runnable validation,
global capacity, immutable Run Context capture, and a fresh certified Direct ACP
session for each Run Attempt. It starts no false resumptions and commits durable
attempt state before external agent work.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Runnable validation MUST return deterministic actionable reasons for repository, Skill, profile, worktree, card, and capacity failures.
2. The global automatic-execution cap MUST default to one, admit one active attempt per card, and never leak or double-reserve capacity.
3. Run Context MUST immutably snapshot card/stage/workflow, effective Skill content and digest, provider/model/effort, repository/worktree baseline, readiness evidence, and generation.
4. Attempt creation MUST commit durable state and context before starting a fresh certified Direct ACP connection/session.
5. Startup failure MUST produce a persisted, legible result that isolates the affected card.
6. This task MUST NOT call loadSession, claim live recovery, advance workflow, auto-publish, or implement queue/blocker behavior.
</requirements>

## Subtasks

- [x] 11.1 Define runnable result and immutable Run Context contracts.
- [x] 11.2 Validate card, board, Skill, worktree, profile, and capacity preconditions.
- [x] 11.3 Implement global scheduler reservation and release behavior.
- [x] 11.4 Commit attempt creation and immutable context before external ACP startup.
- [x] 11.5 Bind fresh Direct ACP sessions to generations and certified readiness.
- [x] 11.6 Add validation, scheduler, context, and fresh-start evidence.

## Implementation Details

Follow the TechSpec Direct ACP profiles integration point and Data Models. Consume
the protocol-free engine contracts and preserve the desktop host as lifecycle
owner.

### Relevant Files

- packages/desktop/src/attempts/runnableValidator.ts — deterministic admission results.
- packages/desktop/src/attempts/scheduler.ts — global capacity reservation.
- packages/desktop/src/attempts/attemptCoordinator.ts — transaction-aware start lifecycle.
- packages/desktop/src/attempts/directAcpAttempt.ts — fresh certified ACP adapter.
- packages/desktop/src/attempts/runnableValidator.test.ts — runnable failure coverage.
- packages/desktop/src/attempts/scheduler.test.ts — capacity coverage.
- packages/desktop/src/attempts/attemptCoordinator.test.ts — context/start ordering coverage.

### Dependent Files

- packages/engine/src/contracts.ts — protocol-free readiness and activity contracts.
- packages/desktop/src/catalog/skillCatalog.ts — immutable effective Skill input.
- packages/desktop/src/worktrees/cardWorktreeService.ts — stable binding prerequisite.

### Related ADRs

- [ADR-004: Persist desktop work as an append-only SQLite journal with projections](adrs/adr-004.md) — creation-before-external-work authority.
- [ADR-006: Resolve Workflow Skills from deterministic project and user catalog roots](adrs/adr-006.md) — immutable Skill provenance.

## Deliverables

- Actionable runnable validator and default-one global scheduler.
- Immutable Run Context and journal-first fresh Direct ACP startup.
- Fake-ACP attempt admission suite.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for context-before-session and failure isolation **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Return distinct reasons for invalid Skill, unavailable profile, untrusted repository, unavailable worktree, invalid override, and exhausted capacity.
  - [x] Admit exactly one default-capacity attempt across boards and release it without leaks.
  - [x] Prove catalog/default/card changes cannot rewrite a stored Run Context.
- Integration tests:
  - [x] With fake Direct ACP, assert journaled attempt/context precede newSession.
  - [x] Assert each new attempt gets a distinct session and generation with no loadSession call.
  - [x] Verify handshake or startup failure persists an isolated legible result.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- No attempt starts without a committed immutable Run Context.
- No desktop path represents an interrupted ACP session as resumed.
