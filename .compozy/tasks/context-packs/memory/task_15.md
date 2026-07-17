# Task Memory: task_15.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add `test/contextPackAdapter.contract.test.ts`: a default-skipped, explicitly credentialed real stdio/ACP certification for one exact pinned built-in provider recipe.
- Certification must prove only scoped `ask_user` plus the three Context Pack tools, a bounded read, one revision-fenced parent mutation, negative authority, deadlines, and cleanup without activating production profiles.

## Important Decisions

- Keep deterministic opt-in/provider/deadline/close/teardown checks in the new contract file and use the real adapter plus real Context Pack bridge only for the credentialed macro path.
- Back the real bridge facade with AppStore state so sibling state, sealed bytes, builder binding, revision fencing, and teardown are observable outcomes rather than mock return values.
- Preserve the existing dirty worktree and stage only task-owned files for the automatic commit.

## Learnings

- Production Context Build and Recipient Profile registries are intentionally empty; certification evidence must not modify them.
- The canonical adapter recipe pattern is `test/clarificationAdapter.contract.test.ts`; lower-level tool/schema and route behavior already lives in `src/agent/contextPackMcp.test.ts` and `test/contextPackBridge.integration.test.ts`.
- The exact pinned `codex` recipe completed the real stdio/ACP certification in 36.62s (6 tests, 58 assertions); the bridge counters were reset after the direct negative probe, so the bounded read, scoped `ask_user`, and parent mutation evidence came from the authenticated child.
- Repository coverage completed with 2,794 passing tests, 5 intentional skips, 0 failures, and the configured coverage threshold satisfied.
- The final authoritative `typecheck && test` gate completed with typecheck clean, 2,794 passing tests, 5 intentional skips, and 0 failures. One preceding full-suite attempt hit the existing Markdown native-parser registration flake; its isolated rerun passed unchanged, and the fresh full gate then passed.

## Files / Surfaces

- Added: `test/contextPackAdapter.contract.test.ts`.
- Tracking/memory only after verification: `.compozy/tasks/context-packs/task_15.md` and this file.
- Narrow local commit: `570cd5b` (`test: certify explore-v2 real adapter contract`), containing only the new contract suite; not pushed.

## Errors / Corrections

- Pre-change baseline: `bun test test/contextPackAdapter.contract.test.ts` exits 1 because the required suite does not exist.
- The repository contains extensive unrelated modified/untracked work; do not stage or rewrite it.
- Credentialed `claude-code` invocation reached the exact pinned adapter but failed before `session/new`: `@anthropic-ai/claude-agent-sdk` has no installed darwin-arm64 native Claude binary. Do not alter the pinned recipe or production profiles to work around certification infrastructure.
- No test assertion or production surface was changed for the transient Markdown failure; the task remains test-only and the isolated failing test plus the subsequent full suite passed unchanged.

## Ready for Next Run

- Implementation, deterministic harness coverage, affected suites, real `codex` certification, repository coverage, full typecheck/test gate, and self-review are complete.
- Task tracking can be marked complete. Keep task/memory tracking files out of the narrow automatic commit; commit only `test/contextPackAdapter.contract.test.ts` and do not push.
