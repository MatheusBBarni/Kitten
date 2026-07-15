# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implement the controller-owned, session-generation-bound authenticated local IPC bridge in `src/app/askUserBridge.ts`, with deterministic unit/local-IPC coverage in `src/app/askUserBridge.test.ts`.
- Completion requires every task_04 security/lifecycle test, at least 80% coverage, the repository `typecheck && test` gate, self-review, tracking updates, and one scoped local commit.

## Important Decisions

- Keep task scope at the app bridge boundary. Controller provisioning and same-binary MCP child behavior remain task_06 and task_05 respectively.
- The bridge declaration uses the protocol-free `McpServerConfig` contract and must not import MCP SDK types.
- Preserve all existing task_01-task_03 and unrelated dirty worktree changes; stage only task_04-owned implementation, tests, memory, and tracking after a clean gate.
- The IPC frame is a closed JSONL envelope (`kind`, opaque `callId`, capability, normalized form). Unknown keys, including caller-supplied session/generation, are rejected before coordinator entry.
- Failure observation is a callback that receives only `AskUserBridgeFailureReason`; raw errors, routes, identities, capabilities, call IDs, and interaction content never cross that seam.
- Bound each route to one authenticated child stream, four concurrent calls, and 256 total unique call IDs so duplicate detection remains route-lifetime complete without unbounded memory.

## Learnings

- The task packet, TechSpec, and ADRs are consistent: ownership is capability-derived, live-generation-only, local socket/pipe only, and content-free on failure telemetry.
- Pre-change baseline: neither `src/app/askUserBridge.ts` nor `src/app/askUserBridge.test.ts` exists.
- Current Bun exposes local IPC through `Bun.listen({ unix })` / `Bun.connect({ unix })`; the same endpoint option supports the platform-specific local path supplied by the bridge.
- Streaming frame parsing must cap the accumulated current frame before concatenation; a single large input chunk is not buffered wholesale.

## Files / Surfaces

- Implemented: `src/app/askUserBridge.ts`, `src/app/askUserBridge.test.ts`.
- Tracking/memory: this file and `.compozy/tasks/ask-user-mcp-bridge/task_04.md` only after verification.

## Errors / Corrections

- The working tree already contains extensive uncommitted source and task-tracking changes from earlier work; they are prerequisites/current context but not authorized for this task's scoped commit.
- The first focused test run had two harness-only failures: a timed-out response waiter remained queued and an oversized binary probe did not reliably flush through a live client. The waiter now removes itself, and oversize parsing is tested deterministically through the injected real handler seam while valid routing remains a real Unix-socket integration test.
- Fresh full gate result: typecheck passed, but the suite finished with 1903 pass, 197 fail, and 4 skip. The first deterministic failures are unrelated release-workflow contract tests rejecting checked-in npm token configuration; later OpenTUI tests cascade into blank frames/timeouts. No task status update or commit is permitted while this broad gate is red.

## Ready for Next Run

- Implementation and 16 focused tests are present. A fresh post-suite targeted gate passes with 16/16 tests and 90.48% function / 97.41% line coverage.
- Task remains pending and uncommitted solely because the required repository-wide gate is red on unrelated existing tests. Re-run the full gate after those baseline failures are repaired; only then update task_04 checkboxes/status and create the scoped commit.
