# Task Memory: task_14.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Bind authenticated `ask_user` routes to desktop attempt ID plus generation, persist one durable Attention Blocker and terminal outcome, enforce `needs_attention` Stage Lock, and record one card-safe notification result before same-attempt continuation.

## Important Decisions

- Keep form validation, route/call lifecycle, blocker authority, and notification policy in `packages/desktop`; reuse only protocol-free question outcomes from `@kitten/engine` and protocol mechanics from the TUI references.
- Persist blocker raise, notification result, and terminal resolution as journal transactions with disposable SQLite projections. Resolve the pending ACP call only after the terminal blocker transaction commits.
- Keep ordinary follow-up queue ordering/versioning separate from attempt activity sequence; gate confirmation/dispatch from the committed active-blocker projection.
- Bind the route capability into fresh Direct ACP session creation while keeping attempt ID and generation inside the desktop-owned route registry; route replacement and revocation cancel any owned blocker with a durable cancelled outcome.
- Keep blocker identity fields immutable across journal updates and enforce one active blocker per attempt with a partial SQLite unique index.

## Learnings

- Task 13 already provides a `hasActiveAttention(attemptId)` seam in the attempt coordinator and rejects confirmation when the attempt is `needs_attention`; Task 14 must supply the durable implementation behind that seam.
- Existing workflow commands already reject operator movement while `running` or `needs_attention`; task-local transition coverage must also prove agent-success movement cannot bypass the blocker.
- Notification delivery is idempotent per blocker in the service, while its delivered/failed result is journaled separately so failure remains visible without resolving the blocker.
- Resolving a blocker appends blocker, card, and attempt projections atomically; only after that append succeeds does the pending scoped call settle, which also keeps follow-up confirmation blocked until durable terminal evidence exists.
- Desktop coverage after implementation is 97.10% functions and above the required 80%; the fresh full repository gate passed 3,214 tests with 5 credentialed/opt-in skips and no failures.

## Files / Surfaces

- Added `packages/desktop/src/attention/*`, `packages/desktop/src/notifications/*`, and `packages/desktop/src/board/cardTransitionCoordinator.ts` for route, blocker, notification, and Stage Lock authority plus focused tests.
- Updated `packages/desktop/src/persistence/{migrations,eventJournal,projectionRebuilder}.ts` and tests for migration 7, durable Attention Blocker projections, immutable identity, transactions, snapshots, and deterministic rebuild.
- Updated `packages/desktop/src/attempts/{directAcpAttempt,attemptCoordinator}.ts` and tests for fresh-session route binding, revocation, queue priority, and the authenticated fake-ACP continuation scenario.
- Updated `packages/desktop/src/workflow/workflowCommands.ts` and tests so both operator moves and agent-success moves reject `needs_attention` cards with `stage_locked`.

## Errors / Corrections

- Initial desktop coverage exposed `attentionCoordinator.ts` below the per-file function threshold; added coverage for default blocker/event identity factories and reran the package gate successfully.
- Self-review found that a repeated blocker ID could change immutable identity inside serialized projection data; added transactional identity comparison and a rollback regression test.

## Ready for Next Run

- Task 14 is complete. Fresh evidence: focused behavior tests 28/28, desktop coverage 85/85 at 97.10% functions, root typecheck and 3,214-test suite green, self-check `SELF-CHECK OK`, and host build/checksum generation successful.
