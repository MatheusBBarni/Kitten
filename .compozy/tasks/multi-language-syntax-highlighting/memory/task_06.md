# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Register the completed parser manifest after worker setup and before cockpit rendering, with the same idempotent guard at Markdown and shared diff construction.

## Important Decisions

- Extend `MainDeps` with injectable registration and render seams so boot order is observable without import-time native allocation.
- Preserve `MARKDOWN_STREAMING`, Markdown normalization, and `filetypeFor()` unchanged; entry leaves only invoke the shared guard.

## Learnings

- The injected boot path now proves the required sequence: embedded worker completion, parser registration, then cockpit render.
- A direct Markdown mount can supply the first registration call while preserving multi-block streaming output; transcript and overlay diffs continue to share the same guarded body and source text.

## Files / Surfaces

- Touched: `src/index.ts`, `src/ui/Markdown.tsx`, `src/ui/ToolCallRow.tsx`, `test/index.integration.test.tsx`, `src/ui/Markdown.test.tsx`, and `src/ui/ConversationView.test.tsx`.

## Errors / Corrections

- The worktree contains unrelated user changes; keep edits and staging restricted to this task's files.
- Do not call `destroyTreeSitterClient()` before the first direct code mount: OpenTUI can leave that mount attached to a destroyed singleton. A fresh-process mount is the valid direct-registration proof.
- Under full-suite load, OCaml render fixtures still need explicit client initialization/preload after the separate direct-mount proof; otherwise the known global client race can blank an `ml` frame.
- A cache-busting dynamic import duplicates `src/index.ts` in Bun coverage and drives that duplicate below the per-file threshold; use an isolated mocked subprocess for the import-only registration assertion.

## Ready for Next Run

- Implementation and task-specific tests are complete.
- Fresh verification: typecheck plus full suite passed with 1,920 tests, 0 failures, and 3 expected opt-in skips; coverage passed at 97.13% functions and 98.13% lines; self-check reported `SELF-CHECK OK`; diff check was clean.
- Task tracking is complete; the six source/test files are ready for the required scoped local commit. Tracking and memory files stay outside that commit.
