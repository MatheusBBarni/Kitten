# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add controller-owned route-authorized batch start and poll while preserving the selected-parent UI adapter and normal visible delegated lifecycle.

## Important Decisions

- Reuse the established managed-worktree child path: route preflight runs before identity/provisioning, then all valid bindings are prepared and ownership/capacity revalidated before the whole accepted batch is registered and concurrent startup begins.
- Keep `AgentRunControl` private to the bridge injection seam; do not add it to `ControllerActions` or the public `SessionController` API.
- Serialize route starts per parent generation so overlapping accepted batches cannot exceed capacity between preflight and registration.
- Treat route ownership loss during startup as `parent-closing`; isolate bridge, session, and initial-prompt failures to the accepted child that failed.

## Learnings

- The current delegated launch path includes pre-registration managed-worktree provisioning from the managed-child-worktrees workflow, so batch launch must preserve rollback and reviewability semantics rather than recreate children in the parent cwd.
- The store's delegation projection already carries the route parent generation on every child, which is sufficient for atomic poll authorization and requested-order snapshots without new lifecycle state.
- Repository-wide isolated coverage can time out in `test/npm-launcher.integration.test.ts` under coverage instrumentation even when the canonical non-coverage suite passes; focused controller coverage is the useful task gate.

## Files / Surfaces

- Implemented: `src/app/controller.ts`, `src/app/controller.test.ts`.
- Tracking: `.compozy/tasks/host-owned-mcp-control/task_05.md` and this task memory.

## Errors / Corrections

- The working tree contains overlapping uncommitted bridge/telemetry/tracking changes from prior tasks; preserve them and stage only understood task-specific changes at commit time.
- A first pass attempted to snapshot a child after route ownership could disappear during startup; the return contract was corrected to make snapshots optional for `parent-closing` outcomes.
- Final self-review found the same ownership-loss race after initial prompt dispatch; capture ownership once and return `parent-closing` without reading a stale child snapshot.
- Full isolated repository coverage timed out at 180 seconds in the inherited npm-launcher integration test. Focused isolated coverage passed with `src/app/controller.ts` at 94.87% lines and 96.23% functions.

## Ready for Next Run

- Task implementation and self-review are complete.
- Fresh focused verification: 311 passed, 0 failed across controller, bridge, and store tests; typecheck and `git diff --check` passed.
- Fresh canonical verification: 2414 passed, 4 credentialed/native-provider tests skipped, 0 failed, 9280 expectations; `SELF-CHECK OK`.
