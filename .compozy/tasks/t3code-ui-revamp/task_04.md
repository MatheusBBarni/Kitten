---
status: pending
title: Build canonical review-evidence capture, revalidation, and chunking
type: backend
complexity: high
---

# Task 04: Build canonical review-evidence capture, revalidation, and chunking

## Overview

Build the host-owned service that captures reproducible changed-file evidence
from a card's registered worktree. It canonicalizes and persists review
artifacts, revalidates the live worktree before disposition, and serves bounded
file chunks without exposing privileged host resources.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Evidence capture MUST resolve only the registered card worktree binding and MUST reject traversal, out-of-root paths, and mismatched bindings.
2. Canonical evidence MUST bind board, card, attempt, generation, worktree binding, Git identities, policy version, ordered file metadata, and content digests.
3. Text handling MUST preserve review semantics for modes, renames, deletions, final-newline markers, and normalized LF content; binary records MUST never expose binary content as text.
4. Capture MUST enforce the TechSpec limits of 2,000 files, 8 MiB per text patch, 64 MiB aggregate patch data, and 64 KiB decoded RPC chunks.
5. Evidence rows, journal reference, and `ready_for_review` transition MUST commit atomically behind card-version and worktree-state preconditions.
6. Revalidation MUST fail closed for missing, stale, oversized, unsafe, unsupported, or incomplete evidence.
7. Results and diagnostics MUST NOT expose absolute paths, raw Git errors, patch blobs, prompts, or host handles.
</requirements>

## Subtasks

- [ ] 4.1 Capture changed-file evidence from the registered card worktree.
- [ ] 4.2 Canonicalize metadata, patches, binary records, ordering, and digest inputs.
- [ ] 4.3 Enforce identity, safety, mutation-race, and size limits.
- [ ] 4.4 Persist evidence and the review-ready lifecycle transition atomically.
- [ ] 4.5 Recompute current evidence for disposition revalidation.
- [ ] 4.6 Serve bounded UTF-8-safe chunks and explicit non-text states.
- [ ] 4.7 Add canonicalization, Git-fixture, transaction, and restart coverage.

## Implementation Details

Follow the TechSpec **Review-Evidence Canonicalization**, **Review-evidence
capture**, and **Git and worktree bindings** sections. Reuse the established
worktree process conventions through a narrow injected runner; do not broaden
worktree ownership or add a new Git dependency.

### Relevant Files

- `packages/desktop/src/host/reviewEvidence.ts` — capture, canonicalization, persistence orchestration, revalidation, and bounded reads.
- `packages/desktop/src/host/reviewEvidence.test.ts` — pure and SQLite-backed evidence coverage.
- `packages/desktop/src/persistence/eventJournal.ts` — transactional lifecycle/evidence persistence seam.

### Dependent Files

- `packages/desktop/src/shared/rpc.ts` — evidence summary, chunk, availability, and precondition contracts.
- `packages/desktop/src/worktrees/gitWorktree.ts` — injectable Git execution conventions.
- `packages/desktop/src/worktrees/contracts.ts` — trusted worktree-binding identities.
- `packages/desktop/src/workflow/workflowTypes.ts` — board/card lifecycle identities.

### Related ADRs

- [ADR-002: Make Blocked Work and Evidence-Bound Review First-Class](adrs/adr-002.md) — evidence must fail closed.
- [ADR-004: Persist Immutable Review Evidence and Page Diffs by File](adrs/adr-004.md) — primary capture, persistence, and paging contract.

## Deliverables

- Canonical, immutable, worktree-bound review-evidence service.
- Fresh revalidation and bounded per-file chunk reads.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for Git fixtures, atomic capture, mutation races, and restart **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Produce identical order and digest from equivalent inputs presented in different file orders.
  - [ ] Normalize CRLF/LF equivalently while changing digests for content, mode, rename, deletion, and final-newline differences.
  - [ ] Return metadata/digests but no text patch for binary records.
  - [ ] Reject 2,001 files, a patch above 8 MiB, and aggregate content above 64 MiB.
  - [ ] Reject traversal, out-of-root, unsafe symlink/submodule, and binding-mismatch inputs.
  - [ ] Return chunks no larger than 64 KiB without splitting UTF-8 code points.
- Integration tests:
  - [ ] Commit evidence rows, journal reference, and `ready_for_review` together for the expected card version.
  - [ ] Roll back all evidence and lifecycle writes after a concurrent card/worktree mutation.
  - [ ] Detect tracked, dirty, and eligible untracked changes after capture as stale.
  - [ ] Reopen SQLite and reproduce the same manifest/digest without snapshot patch blobs.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every review-ready transition is bound to reproducible immutable evidence.
- No unsafe or oversized evidence leaves disposition actions available.
