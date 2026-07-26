# Task Memory: task_09.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Admit an explicit evidence-bound `request_changes` prompt as one durable
  same-card, same-stage replacement attempt, then start fresh Direct ACP only
  after the admission commit.

## Important Decisions

- Reuse the evidence-bound active worktree binding for the replacement attempt.
  Do not call ordinary `worktrees.ensure()` on this path because reviewed
  changes make that worktree intentionally dirty and reconciliation would
  reject it while also mutating binding lifecycle state.
- Reuse the approval seam's evidence/card/attempt/binding validation, but commit
  Request changes through the prompt-admission event shape rather than the
  approval mutation that completes the card.
- Perform all fallible non-mutating admission preparation before evidence
  revalidation, then revalidate immediately before an IMMEDIATE transaction
  that repeats the full evidence-bound guard.

## Learnings

- The pre-Task-09 coordinator intentionally hard-rejected every
  `source: "request_changes"` submission as `evidence_missing`; the implemented
  path now admits only explicit, non-empty, fully evidence-bound submissions.
- Request changes can reuse the unified submission's durable command identity
  while carrying a distinct atomic journal shape: disposition, running card,
  replacement attempt, and immutable Run Context.
- Recovery must rebuild the admitted replacement generation but leave its
  starting attempt interrupted; it must never infer that the reviewer prompt
  can be resent after restart.

## Files / Surfaces

- `packages/desktop/src/attempts/attemptCoordinator.ts`
- `packages/desktop/src/host/reviewDisposition.ts`
- `packages/desktop/src/persistence/eventJournal.ts`
- `packages/desktop/src/host/lifecycleDiagnostics.ts`
- `packages/desktop/src/main.ts`
- Unit and recovery/review integration tests colocated with those seams.

## Errors / Corrections

- Self-review found that the post-inspection scheduler reservation retry dropped
  the review-ready validation exception. The retry now preserves the Request
  changes admission mode.
- The final desktop `verify` command runs all 380 tests successfully but exits
  1 at the inherited 80%-per-file coverage gate. Task-owned coverage is above
  the target: `attemptCoordinator.ts` 91.43% functions / 99.58% lines,
  `eventJournal.ts` 96.95% / 99.50%, `reviewDisposition.ts` 100% / 88.24%, and
  `reviewEvidence.ts` 97.14% / 99.80%. Overall coverage is 92.47% functions /
  93.23% lines.
- The repository-wide `bun test` run passed 3,411 tests and skipped 5, but 100
  ACP/configuration tests failed in one order-sensitive cluster. Rerunning the
  three implicated files in isolation passed all 90 tests, so this remains an
  inherited full-suite isolation/resource issue rather than a Task 09 focused
  regression.
- The native lifecycle harness passes all 17 tests, but `native:verify` cannot
  run the artifact review gate because
  `test/native/artifacts/lifecycle-v1/manifest.json` has not been captured and
  reviewed.
- The final audit required no additional Task 09 code changes; the requested
  implementation and coverage were already present in the shared dirty
  worktree. Only workflow-memory evidence was refreshed in this run.

## Ready for Next Run

- Implementation and focused verification are complete. Fresh evidence:
  46 focused lifecycle/journal/recovery tests pass; desktop and root typecheck,
  acceptance suites, the desktop build, and the 17-test native lifecycle
  harness pass; the isolated ACP/configuration rerun passes 90 tests; and
  `compozy tasks validate --name t3code-ui-revamp` reports all 17 tasks valid.
- Task tracking remains pending and no automatic commit was created because the
  repository `verify` gate still exits non-zero on unrelated low-coverage files
  such as `workflowApiServer.ts`, `main.ts`, and renderer controllers. The
  repository-wide test run and packaged native artifact review are also not
  clean.
