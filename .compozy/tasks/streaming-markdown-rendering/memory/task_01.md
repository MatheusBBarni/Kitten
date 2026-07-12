# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Register the PRD/TechSpec-defined `markup.*` grammar captures in the existing syntax theme, preserving code highlighting, palette reactivity, and cache behavior.
- Prove the registration at the theme layer and the rendered heading foreground through the real transcript path.

## Important Decisions

- Extend the canonical `src/ui/theme.test.tsx` unit suite and the existing `src/ui/ConversationView.test.tsx` integration suite; no new test files or mocks are needed.
- Follow the TechSpec mapping with palette-derived colors only. Strikethrough uses muted foreground plus `dim` because `SyntaxStyle.fromTheme` has no strike attribute.
- Preserve the existing code-scope entries byte-for-byte and append Markdown entries after them.
- Reset OpenTUI's public tree-sitter singleton at the start of the heading integration test; renderer teardown can otherwise leave the next test with a dying global client. The observable foreground assertion remains unchanged.

## Learnings

- Pre-change baseline: `syntaxStyleFor(DARK_PALETTE).getStyle("markup.heading.1")` returns `undefined`.
- The transcript integration boundary is the real store -> `ConversationView`/`MessageView` -> OpenTUI Markdown renderer path, observable through `captureSpans()`.
- The focused unit/integration run passes 51 tests, including the new heading span assertion, but emits OpenTUI `TreeSitter client destroyed` teardown warnings.
- The isolated heading integration test passes cleanly (1 test, 2 assertions), and targeted coverage reports 100% lines/functions for `src/ui/theme.ts`, `ConversationView.tsx`, and `MessageView.tsx`. The targeted coverage command still exits 1 because repository-wide imported-file coverage is 52.69%.
- `bun run typecheck` and `git diff --check` pass. `bun run build` produces the host binary and checksum successfully. `bun run selfcheck` reaches `SELF-CHECK OK` but emits an existing React `act` warning.

## Files / Surfaces

- Touched: `src/ui/theme.ts`, `src/ui/theme.test.tsx`, `src/ui/ConversationView.test.tsx`.
- Tracking/memory: this task memory, `task_01.md`, and `_tasks.md` only after clean completion.

## Errors / Corrections

- The worktree already contains extensive unrelated user changes, including edits in `src/ui/ConversationView.test.tsx`; preserve them and stage only this task's scoped hunks/files.
- Full `bun test --coverage` exited 133 because Bun 1.3.13 segfaulted after unrelated listener/React/tree-sitter warnings, before a coverage summary could be produced. Do not mark complete or commit without a clean replacement gate.
- The first repository-wide `bun test` reached 955 passes but exposed the new heading test receiving a destroyed tree-sitter client. Adding the public singleton reset fixed the isolated test; subsequent normal and single-worker full runs still segfaulted with the same Bun crash and existing warnings before a suite verdict.

## Ready for Next Run

- Implementation and scoped self-review are done, but task status must remain pending. Re-run the full repository gate after the Bun/OpenTUI test-lifecycle instability is resolved; only then update task checkboxes/status, `_tasks.md`, and create the authorized local commit.
