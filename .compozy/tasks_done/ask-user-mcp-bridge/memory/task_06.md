# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Provision one authenticated clarification bridge registration for every eligible ACP session generation, append it after resolved user MCP declarations without changing user order, invalidate it across all controller lifecycle exits, and prove the real child/local-IPC/same-turn path with fake ACP agents.

## Important Decisions

- The controller owns one `AskUserBridge` instance and lazily registers exactly one bridge route per runtime generation before `newSession` or `loadSession` is called.
- `AgentRuntime` records the bridge declaration and generation so repeated provisioning cannot duplicate a route and invalidation targets the exact generation.
- The bridge delegates request settlement to the existing interaction coordinator handle, keeping native ACP clarification and MCP clarification on the same queue, timeout, cancellation, and outcome machinery.
- The generated declaration supports an executable argument prefix. Source runs launch `bun src/index.ts --ask-user-mcp`; compiled runs continue to launch the executable directly with `--ask-user-mcp`.
- User-facing MCP readouts remain about resolved user configuration; the generated internal bridge is appended only to the declarations supplied to ACP session creation.

## Learnings

- A fake ACP agent can receive the controller-generated declaration, spawn the real MCP child over stdio, traverse real authenticated local IPC, submit through the mounted cockpit, and continue the same ACP prompt turn.
- Two concurrent fake ACP sessions using separate real child processes receive only their own replies while retaining stable user MCP declaration order.
- Task 07 is still pending and `ClarificationPrompt.tsx` has no explicit skip action, so task 06 cannot truthfully satisfy its explicit-skip/manual-cockpit completion requirements yet.
- The task-scoped coverage gate is above 80% for the changed controller and bridge behavior.

## Files / Surfaces

- `src/app/controller.ts`: per-generation registration composition, coordinator-backed bridge request handling, and lifecycle invalidation.
- `src/app/controller.test.ts`: fresh, restored, loaded, dynamic, replacement, close, provider-failure, disposal, and isolation coverage.
- `src/app/askUserBridge.ts`: executable argument prefix for source and compiled child launches.
- `test/askUserMcp.integration.test.ts`: real spawned child, real local IPC, fake ACP same-turn continuation, and concurrent routing coverage.

## Errors / Corrections

- The first real-child integration attempt raced child startup; the harness now waits for the pending interaction in the store before asserting the rendered frame.
- Fresh `rtk bun run typecheck && rtk bun test` verification is not clean because `test/releaseWorkflow.test.ts` has two pre-existing failures: the release workflow still exposes `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` where the tests require no registry secret. This is outside task 06 scope.
- The built-in Codex manual smoke has not been recorded. It depends on the pending task-07 operator skip surface and an interactive provider run.

## Ready for Next Run

- Focused typecheck/tests, the real-child integration suite, changed-behavior coverage, compiled-artifact build integration, and `bun run selfcheck` are green.
- Keep `task_06.md` pending and do not update `_tasks.md` or create the automatic commit until task 07 supplies the explicit skip surface, the manual Codex smoke is recorded, and the repository-wide test gate is clean.
