# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Generalize the authenticated ask-user bridge into one Kitten MCP route serving `ask` and `agent_run`, while preserving route lifecycle and controller declaration ordering.

## Important Decisions

- Keep the existing endpoint/capability environment variable names and child-mode flag as compatibility aliases; generalize the app-layer service, listener, failure, and controller factory names.
- Define the protocol-free `AgentRunControl` seam in `kittenMcpBridge.ts`; the controller may omit it until Task 05, in which case authenticated agent calls fail with generic `unavailable`.
- Validate frames with Task 02's strict `agentRunInputSchema`, convert `desired_outcome` to `desiredOutcome`, and serialize only allowlisted child snapshot fields.

## Learnings

- Focused bridge coverage is 91.23% functions and 98.87% lines. Repository-wide isolated coverage reaches the existing `test/npm-launcher.integration.test.ts` boundary and times out after 180 seconds under coverage instrumentation.

## Files / Surfaces

- `src/app/kittenMcpBridge.ts` and `.test.ts` (renamed/generalized from ask-user bridge)
- `src/app/controller.ts`, `src/app/controller.test.ts`, and `test/askUserMcp.integration.test.ts` (factory/executable injection rename)

## Errors / Corrections

- Initial typecheck found one stale `MAX_ASK_USER_CONCURRENT_CALLS` import in the renamed test; migrated it to `MAX_KITTEN_MCP_CONCURRENT_CALLS`.
- A chunked self-review display appeared to duplicate endpoint removal, but a raw line recheck confirmed the source already had one call; no cleanup change was needed.
- Two repository-wide coverage attempts spun in the npm-launcher integration; both agent-started processes were stopped, and the first emitted the existing 180000ms timeout. Continue with the canonical non-coverage full gate but do not claim a clean coverage pipeline.
- The canonical `rtk bun run typecheck && rtk bun test` gate failed twice on the same unrelated OpenTUI `Markdown` frame-predicate timeout (2405 pass, 4 skip, 1 fail). The exact failing test passes in isolation, but the repeated full-suite failure keeps Task 03 pending and prevents the automatic commit.

## Ready for Next Run

- Implementation and task-focused verification are complete in the working tree: 214 focused tests pass, and the generalized bridge alone exceeds the 80% coverage target.
- Resume by repairing or obtaining an explicit waiver for the repository-wide Markdown renderer instability and npm-launcher coverage timeout, then rerun the full clean gate before updating task tracking or committing.
- Preserve the unrelated dirty telemetry, managed-child-worktrees, and Task 01/02 tracking changes; stage only Task 03 source/test changes plus any repository-required tracking files after the gate is clean.
