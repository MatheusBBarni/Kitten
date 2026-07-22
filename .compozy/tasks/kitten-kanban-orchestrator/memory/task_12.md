# Task Memory: task_12.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Persist runtime-validated normalized ACP activity exactly once, build deterministic card-scoped inspector/transcript projections in the same SQLite transaction, and publish/query only committed projection data.

## Important Decisions

- Keep sequence `0` and `1` owned by attempt creation/startup; normalized activity begins at sequence `2` and must be contiguous thereafter.
- Treat Task 12 terminal `attempt_state` activity as durable attempt/card settlement evidence, while leaving stage advancement, queued follow-ups, cancellation steering, and Attention Blockers to their owning tasks.
- Extend the existing shared RPC schema and desktop shell instead of introducing the task brief's illustrative `host/desktopRpc.ts` path; current ownership is `src/shared/rpc.ts` plus `src/main.ts`.
- Derive and persist the inspector inside the journal append/replay transaction from the immutable activity payload; host notifications are best effort and run only after the append returns committed.
- Expose a content-minimized immutable Run Context projection (opaque identities, snapshots/digests, readiness evidence, binding ID) while keeping canonical repository/worktree paths and Skill content only in host-owned persistence.

## Learnings

- Engine already defines protocol-free `NormalizedAttemptEvent`, activity unions, branded IDs, and the pure attempt/generation/sequence classifier, but desktop has no runtime activity validator or ingestion owner.
- The journal already performs append plus projection mutation in one SQLite transaction and deterministic rebuild; Task 12 can extend that seam with activity and inspector projection entities.
- Attempt lifecycle journal sequences `0` and `1` provide the durable prefix, so the first accepted normalized activity is sequence `2`; the activity append path enforces exact contiguity inside the transaction to close concurrent-ingest races.

## Files / Surfaces

- Expected new surfaces: `packages/desktop/src/attempts/activityIngestor.ts`, `packages/desktop/src/attempts/inspectorProjection.ts`, their colocated tests, and `packages/desktop/test/attempt-inspector.integration.test.ts`.
- Existing seams to extend: Direct ACP session contract/coordinator, SQLite migrations, event journal/rebuilder, shared RPC schema, desktop shell/window adapter.
- Implemented engine runtime validation in `packages/engine/src/contracts.ts`; desktop ingestion/projection in `packages/desktop/src/attempts/activityIngestor.ts` and `inspectorProjection.ts`; SQLite migration/journal/rebuild and typed RPC/renderer refresh wiring were extended in place.
- Added colocated engine/desktop unit tests plus `packages/desktop/test/attempt-inspector.integration.test.ts` for fake ACP, commit-before-publish, reopen/rebuild, RPC safety, and card isolation.

## Errors / Corrections

- Initial persisted-inspector validation treated `undefined !== null` as terminal evidence on non-terminal projections; corrected the invariant so outcome equality is checked only when a terminal outcome exists.
- The first integration fixture returned a repository verification path different from the bound board/worktree; corrected the fixture to preserve the trusted-repository identity invariant.

## Ready for Next Run

- Task 12 implementation, focused desktop coverage, repository typecheck, full test suite, self-check, and compiled build all pass.
- Task tracking is complete; keep the task file and workflow memory out of the automatic implementation commit, alongside the pre-existing tracking changes.
