# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Gate final-stage `ready_for_review` on an atomic canonical evidence capture, and
  gate approval on an exact evidence precondition plus fresh worktree
  revalidation.

## Important Decisions

- Preserve the existing non-final-stage `record_agent_success` transition, but
  route final-stage success through the canonical `reviewEvidence` service.
- Replace the legacy approval input/result with the shared typed
  `ReviewDispositionInput` / `ReviewApprovalResult` contract; exact command
  retries remain idempotent, while any mismatched reuse or stale precondition
  appends no disposition.
- Fence capture against both the requested workflow version and repository
  binding before and inside the evidence/readiness transaction, in addition to
  the card, attempt, generation, worktree, and Git-identity fences.
- Require approval to find the matching immutable
  `review_evidence_committed` journal reference and reuse the canonical
  evidence service for the immediately-before-disposition digest
  revalidation.
- Keep a final-stage success that cannot capture trustworthy evidence out of
  `ready_for_review`, and expose the typed evidence reason plus
  `retry_evidence_capture` through the board projection.

## Learnings

- The inherited focused baseline is green (`27 pass`, `0 fail`) but still proves
  the unsafe pre-task behavior: final success publishes `ready_for_review`
  before evidence is captured, and approval selects the latest stored evidence
  without requiring the operator's evidence identity/digest.
- `reviewEvidence.capture` already owns two-pass Git race detection and the
  atomic evidence-row, journal-reference, and readiness transaction. Task 08
  should orchestrate that service rather than duplicate canonicalization.
- The implemented task-owned focused graph passes `54` tests with `0`
  failures. The principal task-owned files exceed the requested 80% line
  coverage: `attemptCoordinator.ts` 86.52%, `boardRpc.ts` 90.34%,
  `desktopRpc.ts` 85.98%, `reviewDisposition.ts` 88.24%, and
  `reviewEvidence.ts` 99.80%.
- The full desktop run passes `272` tests with `0` failures and reaches 91.40%
  function / 92.74% line coverage overall, but `test:coverage` and therefore
  `verify` still exit non-zero on inherited per-file floors, including
  `workflowApiServer.ts`, `main.ts`, and existing renderer controllers.
- The root typecheck/test run passes `3403` tests with `5` skipped and `0`
  failures; desktop acceptance, build, diff-check, and packet validation are
  also green.

## Files / Surfaces

- `packages/desktop/src/attempts/attemptCoordinator.ts`
- `packages/desktop/src/attempts/attemptCoordinator.test.ts`
- `packages/desktop/src/host/boardRpc.ts`
- `packages/desktop/src/host/boardRpc.test.ts`
- `packages/desktop/src/host/reviewEvidence.ts`
- `packages/desktop/src/host/reviewEvidence.test.ts`
- `packages/desktop/src/host/reviewDisposition.ts`
- `packages/desktop/src/host/reviewDisposition.test.ts`
- `packages/desktop/src/host/desktopRpc.ts`
- `packages/desktop/src/host/desktopRpc.test.ts`
- `packages/desktop/src/host/desktopCoordinator.ts`
- `packages/desktop/src/main.ts`
- `packages/desktop/src/shared/rpc.ts`
- `packages/desktop/src/renderer/client.ts`
- `packages/desktop/src/renderer/main.tsx`
- `packages/desktop/test/recoveryReview.integration.test.ts`
- `packages/desktop/test/desktopSmoke.integration.test.ts`
- Desktop shell and Electrobun window contract tests

## Errors / Corrections

- The required skills are repo-installed under `.agents/skills`, not the global
  `.codex/skills` path.
- Do not mark Task 08 complete, update its tracking checkboxes, or create the
  automatic commit while the repository-defined per-file coverage gate remains
  red. The implementation is preserved in the shared dirty worktree.

## Ready for Next Run

- Resume at the repository coverage gate. Re-run `rtk bun run verify` from
  `packages/desktop`; only after it exits zero should Task 08 tracking and the
  automatic local commit proceed.
