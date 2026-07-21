---
status: pending
title: Add workflow board, stage, edge, and card projections/commands
type: backend
complexity: high
---

# Task 08: Add workflow board, stage, edge, and card projections/commands

## Overview

Implement the pure desktop workflow domain for trusted boards, stages,
immediate-successor edges, and cards. It makes the canvas authoritative through
version-fenced, journal-backed commands while keeping Workflow Stage distinct
from Execution Status.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. The workflow domain MUST be protocol-free and model board binding, stages, edges, cards, versions, and separate stage/execution status.
2. Connected workflows MUST validate exactly one path: one start/end, at most one inbound/outbound edge, and no branch, join, or cycle.
3. Board, stage, edge, and card commands MUST append through the journal and reject stale versions with typed conflicts.
4. Rejected validation, stale command, and duplicate mutation identities MUST leave projections unchanged or safely idempotent.
5. Running and needs-attention cards MUST be stage-locked; settled human moves and agent success may use only immediate successors, with final success reaching ready_for_review.
6. No command in this task MAY push, create a pull request, merge, deploy, or complete a card.
</requirements>

## Subtasks

- [ ] 8.1 Define immutable workflow IDs, projections, commands, and conflict results.
- [ ] 8.2 Implement linear-path validation, stage ordering, and successor calculation.
- [ ] 8.3 Implement version-fenced board, stage, and card command handling.
- [ ] 8.4 Materialize committed workflow and card projections.
- [ ] 8.5 Add domain and temporary-SQLite workflow command evidence.

## Implementation Details

Follow the TechSpec Data Models, Typed Desktop RPC, and Testing Approach.
Stage-default Skill validation is represented as configuration state here; catalog
identity validation is supplied by its dedicated task.

### Relevant Files

- packages/desktop/src/workflow/workflowTypes.ts — workflow and card projections.
- packages/desktop/src/workflow/workflowValidation.ts — single-path domain rules.
- packages/desktop/src/workflow/workflowCommands.ts — version-fenced mutations.
- packages/desktop/src/workflow/workflowCommands.test.ts — domain command coverage.
- packages/desktop/src/persistence/eventJournal.ts — committed event boundary.
- packages/desktop/src/persistence/projectionRebuilder.ts — durable workflow replay.

### Dependent Files

- packages/desktop/src/renderer/features/board/WorkflowBoard.tsx — future board consumer.
- packages/desktop/src/attempts/runnableValidator.ts — future runnable assessment.
- packages/desktop/src/attention/attentionCoordinator.ts — future lock transition caller.

### Related ADRs

- [ADR-001: Constrain V1 to a linear governed workflow with queued active-run input](adrs/adr-001.md) — linear path and progress rules.
- [ADR-002: Make Attention Blockers the V1 supervision priority](adrs/adr-002.md) — needs-attention lock.
- [ADR-004: Persist desktop work as an append-only SQLite journal with projections](adrs/adr-004.md) — durable command authority.

## Deliverables

- Versioned, journal-backed workflow and card domain commands.
- Enforced single-path, stage-lock, and human-review progression baseline.
- Domain and persistence integration coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for committed workflow command behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Accept editable starter and custom linear paths and reject disconnected, branched, joined, or cyclic edges.
  - [ ] Verify deterministic stage reordering and stage/execution-status separation.
  - [ ] Reject stale versions and stage movement while a card is locked.
  - [ ] Verify immediate-successor progression and final ready_for_review outcome without completion.
- Integration tests:
  - [ ] Assert command event and projection commit atomically in temporary SQLite.
  - [ ] Reopen and rebuild a board/card view with unchanged ordering and versions.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every accepted workflow mutation is durable and replayable.
- Invalid, stale, or locked mutations leave workflow state unchanged.
