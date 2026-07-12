# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Configure the shared `Markdown` leaf for resize-stable, word-wrapped, selectable tables; verify malformed and unsupported Markdown remains legible; and cover clean copy for rendered tables and fenced code at leaf and transcript integration layers.

## Important Decisions

- Keep all renderer policy in `src/ui/Markdown.tsx`; dependent transcript and hand-off surfaces inherit it without call-site changes.
- Test real OpenTUI rendering and mouse selection through the existing in-memory renderer rather than mocking Markdown internals.
- Configure tables explicitly with full-width balanced columns, word wrapping, and selection. Preserve native table/code selection because OpenTUI already returns tab/newline-delimited source without drawn chrome.
- Normalize only known 0.4.3 degradation cases outside complete fences: display-only task glyphs, readable footnote labels/definitions, removal of unmatched emphasis markers, and removal of an unmatched fence opener so its body remains visible.

## Learnings

- Kitten pins `@opentui/core` 0.4.3. Its installed `MarkdownTableOptions` supports `wrapMode`, `columnFitter`, `widthMode`, and `selectable`, and `TextTableRenderable` recomputes layout in `onResize`.
- Pre-change baseline: `src/ui/Markdown.test.tsx` passes 5 tests, but the leaf has no `tableOptions` and the task-specific resize, degradation, and table/code copy cases do not exist.
- A synthetic closing fence still remains blank with the mandatory streaming pin; removing only the unmatched opener makes the code body legible without altering complete fenced source.
- Full repository coverage passed with 984 tests, 97.32% functions, 98.70% lines, and 100% functions/lines for `src/ui/Markdown.tsx`.

## Files / Surfaces

- Expected scope: `src/ui/Markdown.tsx`, `src/ui/Markdown.test.tsx`, `src/ui/ConversationView.test.tsx`, and task tracking/memory only.
- Touched: `src/ui/Markdown.tsx`, `src/ui/Markdown.test.tsx`, `src/ui/ConversationView.test.tsx`, and this task memory file.

## Errors / Corrections

- Initial degradation tests exposed blank unbalanced fences/nested emphasis and raw task-list/footnote markers; the shared leaf now repairs those cases before rendering.
- The filtered coverage command exited nonzero because Bun applied the global 80% threshold to transitive files; the required full coverage run passed the threshold.
- The final `typecheck && test && selfcheck` gate stopped at `bun test`: 983 passed and the pre-existing transcript heading-style test failed amid repeated inherited `theme_mode` listener-leak and Tree-sitter-client-destroyed warnings. The failed test passed immediately in isolation (1/1), confirming shared UI harness instability rather than a reproducible task behavior failure. Under the clean-gate contract, task status remains pending, self-check was not re-run by the chained command, and no automatic commit was created.

## Ready for Next Run

- Implementation and scoped tests are present. Re-run the warning-free full gate after the shared UI test-harness listener/Tree-sitter teardown instability is resolved; only then update `task_06.md` checkboxes/status and commit.
