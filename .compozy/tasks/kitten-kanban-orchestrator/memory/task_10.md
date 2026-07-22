# Task Memory: task_10.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implement one desktop-owned, durable, verified Git worktree binding per card, reused across fresh attempts and cleaned up only through explicit refusal-first policy.

## Important Decisions

- Keep worktree ownership entirely under `packages/desktop`; `packages/tui/src/app/managedWorktree.ts` is safety precedent only.
- Treat the existing dirty persistence/catalog/workflow changes as prerequisite user state: integrate narrowly and do not rewrite or stage unrelated tracking/source changes.
- Use `.kitten/worktrees/cards/<opaque-binding-id>` and `kitten/card/<opaque-binding-id>`; persist canonical repository/common-Git-dir identity plus baseline branch/commit.
- Reconciliation requires a clean, non-gitlink, attached, baseline-descended authoritative Git worktree. Cleanup is exposed only as `cleanupExplicit` with operator, settled-card, and zero-live-attempt gates.
- Persist every provision/reconcile/refusal/removal fact as `card_worktree_binding_recorded`; the card projection permits lifecycle changes but rejects identity replacement.

## Learnings

- Live prerequisites exist (`packages/engine`, `packages/desktop`, workflow/journal/catalog surfaces), despite older memory documenting a pre-workspace blocker.
- The required `packages/desktop/src/worktrees/` surface is absent, which is the concrete pre-change incompleteness signal.
- A nested managed root must be added to the repository-local Git exclude before provisioning so parent status stays unchanged; every existing path component is checked with `lstat` before recursive creation.
- Scoped worktree coverage reports 83.45% lines for the service, 86.78% contracts, 90.04% Git verification, and 100% projection adapter.

## Files / Surfaces

- Planned: `packages/desktop/src/worktrees/*`; existing journal/migration/rebuild files only where durable projection integration requires it.
- Added: `contracts.ts`, `gitWorktree.ts`, `cardWorktreeService.ts`, `cardWorktreeProjection.ts`, `index.ts`, plus the two colocated safety/integration suites.
- Integrated: persistence migration v3, journal event/projection/snapshot support, rebuild clearing, and migration expectations.

## Errors / Corrections

- The first real-Git cleanup test exposed redundant direct `rm` teardown (`EFAULT`) on a registered worktree; removed that test-only cleanup and retained repository-owned fixture teardown. The isolated behavior then passed.

## Ready for Next Run

- Implementation and self-review are complete. The new surface stays within desktop worktree/persistence ownership and contains no automatic push, pull, force-delete, review cleanup, or recovery cleanup path.
- Scoped desktop tests passed (`48 pass`, `0 fail`); real temporary-Git/SQLite worktree tests passed (`11 pass`, `0 fail`).
- Task-file coverage exceeds 80%: service 83.45%, contracts 86.78%, Git verification 90.04%, projection adapter 100%.
- Full repository verification passed: engine, desktop, and TUI typechecks; `3176 pass`, `5 skip`, `0 fail` across 173 files.
- Task tracking is complete. `_tasks.md` remains unchanged because it owns DAG topology, not normal completion status.
- Local commit created: `236883a feat: add skill catalog and card-owned managed worktrees`. Tracking and workflow-memory files remain intentionally uncommitted.
