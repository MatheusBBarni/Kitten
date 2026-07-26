---
status: pending
title: Admit evidence-bound Request changes on the same card and stage
type: backend
complexity: high
---

# Task 09: Admit evidence-bound Request changes on the same card and stage

## Overview

Extend unified prompt submission with the evidence-bound Request changes path.
An explicitly submitted review draft records the human disposition and starts
one new attempt generation on the same card and stage without creating a
follow-up card or weakening approval semantics.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Selecting or preparing Request changes MUST cause zero host mutation.
2. Only `submitCardPrompt` with `source: "request_changes"` and non-empty explicit text MAY admit a change request.
3. Admission MUST fence card/version, prior attempt/generation, worktree binding, evidence ID/digest, and review-ready state.
4. Fresh evidence revalidation MUST occur immediately before the guarded durable admission.
5. One atomic event/transaction MUST record `changes_requested`, preserve card and stage IDs, advance card state/version, and insert the next attempt generation and immutable Run Context.
6. Durable `commandId` identity MUST make exact replay idempotent and reject reuse with differing content or evidence.
7. ACP startup MUST occur only after durable admission and follow existing failure/recovery behavior.
</requirements>

## Subtasks

- [ ] 9.1 Validate the complete request-changes submission and evidence identity.
- [ ] 9.2 Revalidate worktree evidence immediately before admission.
- [ ] 9.3 Record disposition, same-card/stage state, next attempt, and Run Context atomically.
- [ ] 9.4 Start fresh Direct ACP only after durable commit.
- [ ] 9.5 Enforce idempotency, concurrency, scheduler, and startup-failure behavior.
- [ ] 9.6 Preserve approval as a distinct evidence-bound completion mutation.
- [ ] 9.7 Add selection-no-op, lifecycle, race, restart, and ACP integration coverage.

## Implementation Details

Follow the TechSpec **Review disposition**, **Request changes**, and unified
submission contracts. Share evidence validation with review disposition, but do
not call the approval mutation, which completes a card. The journal requires a
distinct atomic event shape for change-request admission.

### Relevant Files

- `packages/desktop/src/attempts/attemptCoordinator.ts` — request-changes admission and fresh attempt startup.
- `packages/desktop/src/attempts/attemptCoordinator.test.ts` — lifecycle, concurrency, and idempotency coverage.
- `packages/desktop/src/host/reviewDisposition.ts` — shared evidence-bound disposition validation.
- `packages/desktop/src/persistence/eventJournal.ts` — atomic disposition/card/attempt/Run Context event.
- `packages/desktop/test/recoveryReview.integration.test.ts` — end-to-end review-round and restart coverage.

### Dependent Files

- `packages/desktop/src/host/reviewEvidence.ts` — fresh digest and worktree revalidation.
- `packages/desktop/src/shared/rpc.ts` — request-changes submission and stable rejection contracts.

### Related ADRs

- [ADR-001: Adopt a T3 Code-Inspired Supervision Loop While Preserving Kitten's Workflow Model](adrs/adr-001.md) — same card/stage identity.
- [ADR-002: Make Blocked Work and Evidence-Bound Review First-Class](adrs/adr-002.md) — editable draft and explicit send contract.
- [ADR-004: Persist Immutable Review Evidence and Page Diffs by File](adrs/adr-004.md) — fresh evidence revalidation.
- [ADR-005: Treat Enter as Prompt Authorization and Dispatch FIFO at Safe Boundaries](adrs/adr-005.md) — unified submission ownership.

## Deliverables

- Evidence-bound Request changes admission on the existing card and stage.
- Durable, idempotent next-attempt lifecycle and recovery behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for evidence-to-disposition-to-attempt flow **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Create one next-generation attempt with unchanged board, card, and stage IDs.
  - [ ] Bind the disposition to evidence, reviewed card version, prior attempt/generation, and replacement attempt.
  - [ ] Perform zero mutation when Request changes is merely selected or drafted.
  - [ ] Reject empty text, wrong source/state, stale identities, binding mismatch, and every unavailable evidence state.
  - [ ] Roll back disposition, card, attempt, and Run Context after transaction failure.
  - [ ] Admit concurrent exact duplicates once and reject mismatched identity reuse.
  - [ ] Preserve approval as completion-only behavior.
- Integration tests:
  - [ ] Send reviewer text once and only after the durable admission is observable.
  - [ ] Follow established failed-attempt behavior after post-commit ACP startup failure.
  - [ ] Reopen and rebuild the disposition/replacement attempt without ambiguous auto-resend.
  - [ ] Record only content-free outcome diagnostics.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Request changes never creates another card or changes the workflow stage.
- Draft selection is mutation-free and explicit send is the only authorization boundary.
