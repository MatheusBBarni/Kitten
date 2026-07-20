# Task Memory: task_13.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Project successful Context Build completion as a textual, session-owned Context Pack cue without changing ACP status, focus, overlays, or agent-attention ordering.

## Important Decisions

- Store the live-only `ready_for_review` cue in `ContextPackState`; do not reuse `WorkspaceConversation.attention.status`, because that field is the existing ACP `SessionStatus` attention queue.
- Acknowledge the cue atomically on explicit store select/reopen, including reselecting the already-selected visible session, while leaving review opening explicit.

## Learnings

- `WorkspaceConversationView` can carry the frozen textual Context Pack projection without entering `attentionConversationIds`; its cache key preserves stable absent and ready identities.
- Successful and failed Context Build settlement must leave both `SessionState.status` and `WorkspaceConversation.attention` untouched. Only successful settlement publishes `ContextPackState.attention`.
- Starting or binding a replacement build, and any draft mutation, clears a stale ready cue so the tab never advertises an older completion.

## Files / Surfaces

- Touched implementation surfaces: `src/core/types.ts`, `src/store/appStore.ts`, `src/store/selectors.ts`, `src/ui/TabWorkspace.tsx`.
- Touched test surfaces: `src/store/appStore.test.ts`, `src/store/selectors.test.ts`, `src/ui/TabWorkspace.test.tsx`, `src/app/controller.test.ts`.

## Errors / Corrections

- Pre-change lifecycle settlement maps Context Build success to synthetic workspace `finished` attention; task 13 replaces that inherited coupling.
- Self-review found the direct `bindContextBuild` seam also needed to clear an older cue; it now matches `prepareContextBuild`.
- The first all-files coverage invocation timed out only in `test/npm-launcher.integration.test.ts` under instrumentation. Coverage excluding that packaging test passed 2,779 tests; the authoritative normal suite then included it and passed 2,780 tests.

## Ready for Next Run

- Implementation and self-review are complete.
- Fresh verification: typecheck and normal full suite passed (2,780 pass, 4 credentialed skips, 0 fail); coverage excluding the instrumentation-only npm launcher timeout passed (2,779 pass, 4 skips, 0 fail); `TabWorkspace.tsx` reached 92.31% function and 97.89% line coverage; headless self-check reported `SELF-CHECK OK`.
- Local implementation commit: `dc82f47 feat(context-packs): add attention cues` (not pushed). Tracking and workflow-memory files remain outside the commit.
