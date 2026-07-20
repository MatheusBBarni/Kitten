# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the controller-owned Context Build start and cleanup lifecycle for one addressed draft, using exact explore-v2 evidence and the dedicated bridge without focus or consequential-action side effects.

## Important Decisions

- Keep Context Build runtime ownership in the controller and draft/build authority in AppStore; the store prepares the draft and binding in one commit before any bridge or ACP child I/O.
- Launch the child from the re-attested explore-v2 recipe with only the dedicated Context Pack MCP server and no direct ACP filesystem capability, parent connection, or broad ControllerActions facade.
- Treat review readiness as workspace attention only; matching settlement clears the binding without selecting the parent, changing focus/overlays, reviewing, sealing, or delivering.

## Learnings

- Baseline: Context Pack core, AppStore binding, capability evidence, materializer, and dedicated bridge primitives exist, but ControllerActions/controller have no Context Build start or advisory availability surface yet.
- The worktree contains unrelated in-progress changes; task_07 edits and staging must remain narrowly scoped.
- Ordinary AgentConnection instances advertise ACP read/write filesystem handlers. Context Build children must explicitly use `fileSystemAccess: "none"` or they can bypass the bounded Context Pack bridge.
- The ACP SDK normalizes an omitted filesystem capability to explicit `false` values on the wire; tests should assert `false`, not `undefined`.

## Files / Surfaces

- `src/app/actions.ts`, `src/app/actions.test.ts`: typed fail-soft start and availability surface.
- `src/app/controller.ts`, `src/app/controller.test.ts`: evidence/generation/workspace preflight, atomic launch, dedicated bridge facade, matching cleanup, and race/focus coverage.
- `src/store/appStore.ts`, `src/store/appStore.test.ts`: atomic draft preparation/binding and exact-identity settlement.
- `src/agent/agentConnection.ts`, `src/agent/agentConnection.test.ts`: bridge-only child mode with no direct ACP filesystem authority.
- `test/fakeController.ts`: fail-closed fake action compatibility.

## Errors / Corrections

- The first full isolated coverage run timed out in the unrelated local npm launcher install test. After the normal full suite warmed its package cache, the authoritative coverage command passed cleanly on rerun.
- Self-review caught the direct ACP filesystem authority inherited by ordinary AgentConnection instances; the child factory and adapter were hardened before final verification.

## Ready for Next Run

- Task 07 implementation is complete and verified. The child lifecycle is generation/revision fenced, stale cleanup is inert, and later UI/review tasks can call the typed ControllerActions surface.
- Verification: `bun run typecheck && bun test` passed with 2,723 pass, 4 credential-gated skips, 0 failures; `bun run test:coverage` passed with the same test totals. Scoped touched-file coverage is above 80% for adapter, actions, controller, and store.
