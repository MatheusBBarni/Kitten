# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add release-gated JSON and Bash capabilities to the existing static syntax manifest, including Markdown aliases, extension-backed diff fixtures, and no-guess regression evidence.

## Important Decisions

- Vendor byte-identical assets from the official MIT-licensed npm artifacts `tree-sitter-json@0.24.8` and `tree-sitter-bash@0.25.1`; both publish a versioned WASM binary and upstream `queries/highlights.scm`.
- Extend the existing `ConversationView` diff integration matrix rather than introducing a new renderer seam or changing `filetypeFor()`.

## Learnings

- Pre-change resolution returns `undefined` for `json`, `bash`, `sh`, and `shell`, providing the task baseline signal.
- OpenTUI normalizes several injected aliases to their canonical parser filetype inside `CodeRenderable`; validate declared labels through the injection map and copy preservation rather than asserting internal alias retention.

## Files / Surfaces

- `src/ui/syntaxParsers.ts` and `src/ui/syntaxParsers.test.ts`: JSON/Bash parsers, aliases, injection labels, fixtures, uniqueness, and local-asset coverage.
- `src/ui/Markdown.test.tsx`: canonical/alias foreground and copy-safe fence evidence.
- `src/ui/ConversationView.test.tsx`: `.json`/`.sh` diff foreground evidence plus retained extensionless/dotfile no-guess tests.
- `src/ui/syntax-assets/{json,bash}/`, `LICENSE.tree-sitter-{json,bash}`, and asset `README.md`: byte-identical reviewed assets, licenses, upstream versions, and checksums.
- `.compozy/tasks/multi-language-syntax-highlighting/task_04.md`: completion tracking; `_tasks.md` remains unchanged.

## Errors / Corrections

- Removed an invalid renderer assertion that expected every `CodeRenderable.filetype` to retain the fence alias; focused evidence showed canonical normalization for `rs`, `ml`, `mli`, and `sh` while highlighting and copied source remained correct.

## Ready for Next Run

- Implementation and self-review are complete. Focused renderer tests pass 75/75; full coverage passes 1,911 tests with 0 failures, 98.13% line coverage overall, and 100% for `syntaxParsers.ts`.
- Final pre-commit gate passed with `NO_COLOR` removed from the test environment: typecheck plus 1,911 tests, 3 expected opt-in skips, 0 failures, and no warnings.
