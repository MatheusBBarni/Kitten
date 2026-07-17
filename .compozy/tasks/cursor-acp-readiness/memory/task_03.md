# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add one deliberate, no-throw `ControllerActions.recheckCursor(sessionId)` that restarts only an eligible unavailable configured Cursor runtime and preserves healthy siblings.

## Important Decisions

- Keep eligibility and lifecycle replacement inside `src/app/controller.ts`; `src/app/actions.ts` only exposes a void fail-soft facade and routes rejected seams to `onError`.
- Reuse the existing Cursor preflight, `startSession`, failure normalization, generation fencing, and target-only disposal behavior; add no reducer event, telemetry category, or provider-generic restart.

## Learnings

- `failSession` intentionally disables event acceptance and clears ACP identity after startup failure, so recheck must explicitly prepare a fresh generation and re-enable target event acceptance before calling `startSession`.
- Connection update subscriptions also need generation fencing: unsubscribing the old target is necessary but a stale callback can already be queued, so all controller update subscriptions now reject events from superseded generations.
- The worktree already contains unrelated modified and untracked files; edits and any eventual staging must stay limited to task_03 surfaces.

## Files / Surfaces

- `src/app/controller.ts`: eligible target-only replacement lifecycle, stale subscription disposal, and generation-bound update subscriptions.
- `src/app/actions.ts`: public no-throw `recheckCursor(sessionId)` facade with target-session error routing.
- `src/app/controller.test.ts`, `src/app/actions.test.ts`: recovery, repeat failure, inert eligibility, no-throw containment, real-adapter integration, and sibling isolation coverage.
- `test/fakeController.ts`: required `ControllerActions` test-double surface.

## Errors / Corrections

- The first focused test run failed five new cases because the action did not exist, confirming the intended red baseline; after implementation the focused suite passes 218/218.
- Typecheck exposed the required fake-controller action surface, which was added without changing its existing behavior.
- Self-review found that unsubscription alone did not fence an already queued stale update callback; subscriptions were centralized behind the current-generation guard.
- A narrow two-file coverage invocation passes all 218 tests but exits non-zero against the repository-wide coverage threshold, so it is not the coverage authority. The full isolated coverage gate is authoritative and passes 2,566 tests with 0 failures at the configured threshold.

## Ready for Next Run

- Implementation and focused verification are clean; `git diff --check` passes for all task surfaces.
- The canonical `rtk bun run typecheck && rtk bun test` gate remains blocked by the inherited non-isolated `Markdown > registers capabilities on a direct multi-block mount before code rendering` failure (2,565 pass, 4 skip, 1 fail). Keep task status pending, do not check tracking boxes, and do not commit until that repository-wide gate passes cleanly.
