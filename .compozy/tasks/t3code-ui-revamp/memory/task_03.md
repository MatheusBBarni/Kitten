# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implement append-only migration v9, immutable review-evidence persistence,
  evidence-bound repeated dispositions, atomic lifecycle commits, and bounded
  deterministic snapshot rebuilds without patch blobs.

## Important Decisions

- Preserve the uncommitted Task 01 RPC contracts and Task 02 queue-v2/event
  journal changes already present in the worktree; extend overlapping
  persistence surfaces without reverting or restaging those task-owned edits.
- Keep evidence capture/canonical Git logic out of Task 03. This task owns the
  storage, validation, transaction, and summary-rebuild seam consumed by the
  later host review-evidence service.
- Keep patch blobs in immutable file rows and expose them only through the
  explicit evidence lookup. Normal snapshots derive one manifest-only summary
  per card using `created_at DESC, evidence_id DESC`.
- Preserve migrated v8 approval rows as explicitly legacy unbound history, but
  require every post-v9 disposition insert to carry a composite foreign-key
  binding to evidence identity, card, attempt, generation, digest, and worktree.
- Scope the transaction callback synchronously and reject leaked or nested use
  so evidence and journal operations cannot silently escape the `IMMEDIATE`
  SQLite boundary.

## Learnings

- Pre-change persistence migrations stop at version 8. The existing focused
  event-journal suite passes 10 tests against that old contract, so migration
  history and required evidence behavior are both absent rather than failing.
- The packet, TechSpec, and ADRs agree on append-only v9, immutable per-file
  patch storage, evidence-bound repeated review rounds, and queue-v2 recovery.
- Projection rebuild must retain immutable evidence and disposition rows rather
  than delete them. Journal replay verifies/reuses exact disposition identities
  while rebuilding mutable card/attempt/queue projections.
- Full acceptance passes. Full coverage executes 229 tests with zero failures
  and reports 91.61% functions / 92.29% lines overall. Task 03 surfaces exceed
  80% (`eventJournal.ts` 96.72% / 99.46%,
  `reviewEvidencePersistence.ts` 96.67% / 99.69%,
  `migrations.ts` 100% / 100%, `projectionRebuilder.ts` 100% / 97.67%),
  but the command exits 1 on inherited per-file deficits in unrelated
  host/renderer files.
- The full `verify` command freshly reproduces that boundary: typecheck,
  acceptance, and all 229 tests pass before the inherited per-file coverage
  floor exits 1. The independent packaged Electrobun build passes.
- `compozy tasks validate --name t3code-ui-revamp` passes all 17 packet tasks.
  The native lifecycle capture runner is intentionally assigned to pending
  Task 17 and is not present yet, so no native capture can be produced in this
  task without crossing the packet boundary.

## Files / Surfaces

- Touched: `packages/desktop/src/persistence/migrations.ts`,
  `reviewEvidencePersistence.ts`, `eventJournal.ts`, `eventJournal.test.ts`,
  and `projectionRebuilder.ts`.
- Compatibility updates: `packages/desktop/src/host/reviewDisposition.ts` and
  its unit/integration fixtures now refuse approval when no evidence summary is
  persisted and bind accepted approvals to the latest stored summary.

## Errors / Corrections

- The worktree contains prior uncommitted Task 01/02 implementation and tracking
  changes. Task 03 must stage only its own code/tracking/memory surfaces.
- The packet's `bun --cwd packages/desktop run ...` command form prints Bun
  usage in this environment. Run desktop scripts with
  `workdir=packages/desktop` and `rtk bun run ...` instead.
- The repository-defined coverage gate remains red for inherited unrelated
  files including `host/workflowApiServer.ts`, `host/electrobunWindow.ts`,
  `main.ts`, and renderer board/query controllers. Do not mark Task 03
  complete or commit while that full gate exits non-zero.

## Ready for Next Run

- Task 03 implementation and focused persistence/integration coverage are
  present and self-reviewed, with `git diff --check` clean.
- Keep `task_03.md` and `_tasks.md` pending and do not commit until the
  repository-defined per-file coverage gate is green and the packet's native
  lifecycle gate is available or explicitly waived.
