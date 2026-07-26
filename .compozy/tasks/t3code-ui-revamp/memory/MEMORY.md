# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

- Task 01 contract implementation is present in the worktree but remains pending and uncommitted because the repository-defined desktop `verify` gate exits non-zero at coverage.
- Task 05's revisioned supervision projection and host/Electrobun query are
  present with green focused tests and build, but remain pending and
  uncommitted for the same repository coverage-gate failure.
- Task 06's immutable review manifest and bounded diff-chunk RPC/query bindings
  are present with green focused tests, acceptance suites, typecheck, and
  build. It remains pending and uncommitted because the same inherited
  repository coverage gate exits non-zero.
- Task 08's evidence-gated final-stage readiness and evidence-bound approval
  lifecycle are present with green focused tests, integration coverage,
  acceptance suites, root tests, typecheck, build, and packet validation. It
  remains pending and uncommitted because the same inherited per-file coverage
  gate exits non-zero.
- Task 09's evidence-bound Request changes admission is present with atomic
  same-card/stage replacement-attempt persistence, fresh evidence
  revalidation, durable command idempotency, and post-commit Direct ACP
  startup. Focused tests, recovery integration, acceptance suites, typecheck,
  build, and packet validation are green. It remains pending and uncommitted
  because the inherited per-file coverage gate exits non-zero; the latest
  repository-wide test run also exposed an order-sensitive ACP/configuration
  failure cluster that passes in isolation.
- Task 14's default-off local workflow measurement boundary is present with a
  closed content-free schema, bounded JSONL aggregates, isolated host hooks,
  revision-fenced Settings opt-in, and unit/integration coverage. Focused
  verification, all desktop tests, build, and packet validation are green. It
  remains pending and uncommitted because the inherited per-file coverage gate
  exits non-zero.
- Task 16's responsive supervision shell is present with labelled wide
  navigation/board/workbench regions, a focused narrow workbench with
  restorative Back navigation, semantic status tokens/text, and generated
  focus/reduced-motion output. Focused tests and build are green. It remains
  pending and uncommitted because the same per-file coverage gate exits
  non-zero.

## Shared Decisions

## Shared Learnings

- Task 02's queue parser now provides deterministic schema-v1 to schema-v2
  normalization and startup interruption recovery. Task 03 still owns the
  append-only migration-v9 DDL/data persistence, and Task 07 still owns removal
  of the legacy public `queueFollowUp` / `confirmQueuedFollowUp` adapter.
- In this environment, run desktop Bun scripts from `packages/desktop` as
  `rtk bun run <script>`. The `rtk bun --cwd packages/desktop ...` form can
  print Bun usage while returning a misleading success status.

## Open Risks

- Desktop coverage currently enforces 80% per file and fails on unchanged
  surfaces including `src/host/workflowApiServer.ts`, `src/main.ts`, and
  existing renderer controllers. The latest Task 09 run passed all 380 tests
  with 92.47% function / 93.23% line coverage overall. Task 09's focused
  `attemptCoordinator.ts` is 91.43% function / 99.58% line covered,
  `eventJournal.ts` is 96.95% / 99.50%,
  `reviewDisposition.ts` is 100% / 88.24%, and `reviewEvidence.ts` is 97.14% /
  99.80%. The inherited per-file failures still block clean task completion
  and automatic commits.
- The latest Task 14 run passes all 348 tests with 92.35% function / 93.34%
  line coverage overall. Task 14's `lifecycleDiagnostics.ts` is 90.91% /
  99.54%, `workflowMeasurement.ts` is 100% / 98.80%, `desktopRpc.ts` is 100% /
  81.20%, and Settings measurement surfaces are above 80%. The same unrelated
  per-file failures still block clean completion and automatic commits.
- The latest Task 16 `verify` run passes all 360 isolated tests with 92.38%
  function / 93.10% line coverage overall, but `WorkflowBoard.tsx`,
  `WorkflowBoardContainer.tsx`, and renderer `main.tsx` are also below the
  80%-per-file policy alongside inherited low-coverage host/controller files.

## Handoffs
