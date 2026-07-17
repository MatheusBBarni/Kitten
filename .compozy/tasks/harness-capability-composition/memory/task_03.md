# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Make `AgentConnection` envelope-only: attached MCP server names must never add hidden prompt blocks for fresh or loaded sessions.
- Preserve explicit harness envelopes, exact certified-profile validation/encoding, ordinary prompt mapping, bridge provisioning, bundled MCP tool behavior, handoff confirmation, and redaction.

## Important Decisions

- Limit production edits to the adapter's inferred-guidance state/helper path; the existing dirty bundled-MCP failure-classification changes in the same files are unrelated user state and must remain intact.
- Treat the controller-supplied `HarnessPromptEnvelope` as the sole optional-guidance source for both new and restored sessions.

## Learnings

- Pre-change evidence: the focused adapter tests named `adds hidden ask_user guidance...` pass because `askUserMcpAttached` prepends `ASK_USER_MCP_HOST_GUIDANCE` after both `newSession` and `loadSession`.
- Existing certified-profile tests already cover all three provider-specific `_meta` encoders and fail-closed rejection; they can be strengthened by attaching the bridge without changing the envelope contract.
- `ASK_USER_MCP_HOST_GUIDANCE` became dead adapter-era wording after removing inference; deleting it avoids leaving a second prompt-wording owner. `ASK_USER_MCP_INSTRUCTIONS` remains unchanged MCP server metadata.

## Files / Surfaces

- Touched task scope: `src/agent/agentConnection.ts`, `src/agent/agentConnection.test.ts`, `src/agent/askUserMcp.ts`, `test/clarificationLifecycle.integration.test.tsx`, `src/ui/HandoffPreview.test.tsx`.

## Errors / Corrections

- The worktree is intentionally dirty with unrelated task tracking, site, Cursor, bundled-MCP classification, and controller changes. If verification becomes clean, stage only this task's understood code/test hunks; keep workflow tracking and memory out of the automatic commit.
- The required final gate is not clean: `rtk bun run typecheck && rtk bun test` reproduced the same unrelated `src/ui/Markdown.test.tsx` direct multi-block mount timeout twice. Each run ended with 2,575 passing, 4 credentialed/manual skips, and 1 failure. The isolated failing test passes, and the earlier isolated coverage run passed the full suite.

## Ready for Next Run

- Implementation and self-review are complete, but task status and checkboxes remain pending because the repository-wide gate is red.
- Focused task files: 119 passed, 0 failed. Expanded adapter/bridge/tool/controller/handoff regression set: 396 passed, 0 failed.
- Coverage: 2,576 passed, 4 skipped, 0 failed; 97.18% functions and 98.21% lines overall, with `src/agent/agentConnection.ts` at 97.14% functions and 99.71% lines.
- No task commit was created. Re-run the required full gate after the inherited Markdown renderer timing failure is resolved or stabilized, then update task tracking and stage only task-owned hunks.
