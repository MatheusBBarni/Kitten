# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add canonical Rust (`rust`, `rs`) and Go (`go`, `golang`) parser capabilities, local assets, Markdown/diff fixtures, and renderer proof without boot, self-check, build, or `filetypeFor()` changes.

## Important Decisions

- Source WASM and highlight queries from exact official grammar packages (`tree-sitter-rust@0.24.0`, `tree-sitter-go@0.25.0`) so grammar, query, license, and provenance remain aligned.
- Extend the Task 1 manifest directly; retain Markdown as the injection-owner capability and add Rust/Go as their own canonical capabilities.

## Learnings

- Pre-change signal: all four requested labels resolve to `undefined`, and the manifest contains only the Markdown capability.
- OpenTUI 0.4.3 peers on `web-tree-sitter@0.25.10`; the official current grammar packages ship WASM artifacts and their matching highlight queries.
- The Rust and Go manifest module reached 100% function and line coverage in the repository coverage run.

## Files / Surfaces

- Touched: `src/ui/syntaxParsers.ts`, `src/ui/syntaxParsers.test.ts`, `src/ui/Markdown.test.tsx`, `src/ui/ConversationView.test.tsx`, `src/ui/syntax-assets/README.md`, and the Rust/Go asset directories under `src/ui/syntax-assets/`.
- Tracking-only: this task memory and `task_02.md`; shared memory received only the reusable client-initialization lesson.

## Errors / Corrections

- Calling `preloadParser()` before `TreeSitterClient.initialize()` returned false in renderer tests; corrected the proof seam to initialize before preloading.
- Comparing diff tokens directly to the palette text color did not distinguish semantic highlighting from the diff renderer's default foreground; corrected assertions to compare a semantic sentinel with a plain identifier in the same rendered diff.

## Ready for Next Run

- Rust/Go canonical labels, aliases, local assets, Markdown injections, deterministic fixtures, fenced rendering, copy safety, extension-derived diffs, and no-guess paths are covered.
- Fresh gate: `rtk env -u FORCE_COLOR bun run typecheck && rtk env -u FORCE_COLOR bun test` completed with 1,889 pass, 3 opt-in skips, and 0 failures.
- Coverage gate: `rtk bun run test:coverage` completed with 1,889 pass, 3 opt-in skips, 0 failures, and `syntaxParsers.ts` at 100% functions/lines.
