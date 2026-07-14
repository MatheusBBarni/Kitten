# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add release-gated Python highlighting through the shared manifest for `python`, `py`, and `.py` while preserving copy and no-guess behavior.

## Important Decisions

- Vendor `tree-sitter-python@0.25.0` assets from the official npm package; it is MIT-licensed and publishes both `tree-sitter-python.wasm` and `queries/highlights.scm`.
- Keep task 05 limited to manifest assets and stable renderer fixtures; boot registration, diagnostics, and compiled-artifact proof remain owned by tasks 06-08.
- Preserve unrelated dirty worktree changes and stage only task 05 implementation files for the automatic commit.

## Learnings

- Python class-name captures can share a foreground with comparison variables in the current palette; the stable `.py` regression uses a string sentinel instead.
- The final full gate passed with 1,918 tests, 3 expected opt-in skips, and no failures; coverage was 97.13% functions / 98.13% lines overall and 100% / 100% for `syntaxParsers.ts`.

## Files / Surfaces

- Touched: `src/ui/syntaxParsers.ts`, `src/ui/syntaxParsers.test.ts`, `src/ui/Markdown.test.tsx`, `src/ui/ConversationView.test.tsx`, `src/ui/syntax-assets/README.md`, `src/ui/syntax-assets/LICENSE.tree-sitter-python`, and `src/ui/syntax-assets/python/`.

## Errors / Corrections

- Pre-change probe confirmed `python` and `py` resolve to no filetype and no Python capability/parser exists.
- The first `.py` diff fixture compared a class-name capture whose palette color matched the variable comparison token; switched to a string sentinel, which exercises a reliably distinct Python capture.

## Ready for Next Run

- Task 05 implementation is verified and ready for its narrow local commit; later compiled-artifact/self-check work can consume the manifest's Python fixtures.
