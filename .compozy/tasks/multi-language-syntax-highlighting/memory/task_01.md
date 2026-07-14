# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Establish the typed static syntax manifest, local Markdown parser assets, preserved baseline injection map, and idempotent registration seam without renderer or boot wiring.

## Important Decisions

- Own `markdown` and `markdown_inline` parser entries locally in task 1; preserve JavaScript/TypeScript injection targets by their existing OpenTUI canonical filetypes instead of expanding scope to vendor those grammars.
- Vendor the pinned `@opentui/core` 0.4.3 Markdown assets byte-for-byte and record hashes and license provenance beside them.
- Keep registration synchronous, process-idempotent, and injectable so contract tests can prove one registrar call without initializing OpenTUI.
- Track idempotency per registrar function so an injected test registrar cannot suppress later registration through the real OpenTUI registrar in the same process.

## Learnings

- OpenTUI 0.4.3 replaces default parser entries by `filetype` and snapshots overrides when the shared Tree-sitter client initializes, so registration must eventually happen before client initialization.
- The public `FiletypeParserOptions` contract accepts local string paths for WASM, highlight queries, injection queries, aliases, and injection mappings.
- Bun source runs resolve static `with { type: "file" }` imports to existing local asset paths; narrow `.scm` and `.wasm` declarations are required for `tsc`.

## Files / Surfaces

- Touched: `src/ui/syntaxParsers.ts`, `src/ui/syntaxParsers.test.ts`, `src/ui/syntax-assets.d.ts`, and `src/ui/syntax-assets/`, plus task-local memory/tracking.

## Errors / Corrections

- Initial focused typecheck found missing `.scm`/`.wasm` module declarations and a readonly-array assertion mismatch; add narrow asset declarations and compare against a mutable parser-array copy.
- Self-review found the local-asset assertion assumed POSIX separators; normalize separators in the assertion for Windows CI parity.

## Ready for Next Run

- Existing `src/ui/Markdown.test.tsx` baseline: 12 passing tests before implementation.
- Completed: manifest contract coverage is 100% lines/functions; all 12 Markdown regression tests pass; full gate passes with 1,877 tests, 3 opt-in skips, and 0 failures across 114 files.
- Task 2 can extend `syntaxParserManifest.capabilities`, `syntaxParserManifest.parsers`, and the Markdown injection map without adding a second registry.
