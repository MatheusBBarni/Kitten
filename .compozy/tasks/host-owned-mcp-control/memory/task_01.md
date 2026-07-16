# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Compose the existing `ask_user` child mode behind one reusable registrar-based MCP server and runner without adding `agent_run` yet.

## Important Decisions

- `kittenMcp.ts` owns the stable child flag/server-name values, generic registrar composition, and transport-close lifecycle; `askUserMcp.ts` keeps compatibility aliases and wrappers.
- `src/index.ts` dispatches the reserved child through an injectable early dispatcher so boot isolation and generic failure output are directly testable.

## Learnings

- MCP SDK 1.29.0 exposes transport `onclose`; the existing connect-then-await lifecycle remains valid when factored into the generalized runner.
- The pre-change `ask_user`, same-binary, and first-run regression baseline was green; the missing signal was the absent `src/agent/kittenMcp.ts` composition seam.

## Files / Surfaces

- Added: `src/agent/kittenMcp.ts`, `src/agent/kittenMcp.test.ts`.
- Modified: `src/agent/askUserMcp.ts`, `src/index.ts`, `test/firstRunBoot.test.ts`.

## Errors / Corrections

- The first baseline shell probe short-circuited after confirming the new module was absent; the regression baseline was rerun separately and passed.
- The first full-suite gate hit the known `Markdown.test.tsx` renderer timing instability. The exact test passed immediately in isolation, and a fresh sanitized full gate passed all runnable tests plus self-check.

## Ready for Next Run

- Task implementation, regression evidence, coverage, full-suite verification, self-review, tracking, and scoped local commit `8b7d032` are complete. The second bundled tool remains intentionally deferred.

## Verification Evidence

- Assigned task tests: 56 passed, 0 failed.
- Coverage: 2,371 passed, 4 credentialed/manual skips, 0 failed; overall 97.21% functions and 98.21% lines, with `src/agent/kittenMcp.ts` at 100%.
- Final clean gate: `typecheck`, 2,371 runnable tests, and `selfcheck` all passed with `FORCE_COLOR` removed from the inherited environment.
