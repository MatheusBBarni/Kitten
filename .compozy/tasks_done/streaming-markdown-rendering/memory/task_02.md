# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the shared Markdown leaf, migrate both MessageView roles through it, and prove styling, streaming, selection-copy, and transcript integration behavior.

## Important Decisions

- Preserve task_01's existing theme-scope changes as a dependency; do not modify or stage them as task_02 work.
- Keep the leaf prop surface to `content` and optional `fg`; palette, syntax style, streaming, and conceal remain leaf-owned.
- Preserve the existing MessageView wrappers exactly so the agent label, user surface band, and spacing remain surface-specific.

## Learnings

- Direct OpenTUI Markdown tests must keep requesting frames while awaiting asynchronous tree-sitter heading styling; an otherwise-idle minimal renderer can stop before the worker result paints.
- Await every descendant `CodeRenderable.highlightingDone` before destroying a direct Markdown test renderer, or pending highlight work can emit `TreeSitter client destroyed` warnings after a green assertion.
- An untyped fenced block isolates the task_02 streaming-retention contract; a language-tagged fence additionally exercises the task_03 compiled/highlighting path.
- Focused and full coverage report 100% functions and lines for both `Markdown.tsx` and `MessageView.tsx`; the full suite reports 97.30% functions and 98.61% lines overall.

## Files / Surfaces

- Touched task-owned source surfaces: `src/ui/Markdown.tsx`, `src/ui/Markdown.test.tsx`, `src/ui/MessageView.tsx`, and `src/ui/MessageView.test.tsx`.
- Existing `src/ui/ConversationView.test.tsx` already covers role/band treatment and heading survival across streamed deltas; avoid editing the user's current changes unless an uncovered requirement requires it.

## Errors / Corrections

- The worktree contains extensive unrelated user changes. Restrict edits and any eventual commit to task-owned paths plus workflow tracking files.
- The first multi-block test used a `ts` fence, which left real highlighting asynchronous and crossed into task_03 concerns; corrected it to an untyped fence while retaining the required fenced-code visibility assertion.
- Focused unit tests are warning-free (6 pass, 0 fail), and the required ConversationView streaming case passes, but its existing teardown emits `TreeSitter client destroyed`.
- Full `bun run typecheck && bun test` and `bun run test:coverage` both exit 0 with 962 pass and 0 fail, but emit pre-existing React `act(...)` and excess `theme_mode` listener warnings. `bun run selfcheck` reaches `SELF-CHECK OK` but also emits the `act(...)` warning.
- `cy-final-verify` requires zero warnings, so task status/checklists remain pending and no automatic commit was created.

## Ready for Next Run

- Implementation and scoped tests are ready for review. Re-run the full warning-clean gate after the repository-wide React/test-renderer warnings are resolved or explicitly waived; only then update `task_02.md` tracking and create the task-scoped commit.
