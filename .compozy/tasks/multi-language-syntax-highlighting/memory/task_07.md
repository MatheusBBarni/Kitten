# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add an injected, allowlisted diagnostic seam and prove complete Markdown fences and diffs fail closed to labelled, copy-safe plaintext without enabling telemetry.

## Important Decisions

- `syntaxParsers.ts` remains the metadata and sanitization owner. UI surfaces provide only a label/extension, surface, reporter, and injectable parser-status resolver; reporters receive a newly constructed allowlisted event.
- The reporter boundary rejects runtime-invalid diagnostic kinds and surfaces in addition to stripping non-allowlisted fields and filetypes.
- Unknown, unavailable, warning, and error outcomes remove the parser hint before rendering. Complete fallback fences expose the original label as reading chrome while leaving fenced source bytes unchanged.

## Learnings

- OpenTUI concealment hides complete fallback fence labels, so the fallback must be a dedicated untyped `code` leaf with separate label chrome rather than a raw unknown `filetype` passed into `<markdown>`.
- Diff extensions must pass through manifest resolution before reaching `<diff>`; otherwise unknown extensions are forwarded as guessed parser hints even though OpenTUI eventually paints plaintext.

## Files / Surfaces

- Touched: `src/ui/syntaxParsers.ts`, `src/ui/Markdown.tsx`, `src/ui/ToolCallRow.tsx`, `src/ui/syntaxParsers.test.ts`, `src/ui/Markdown.test.tsx`, `src/ui/ToolCallRow.test.tsx`, and `test/index.integration.test.tsx`.

## Errors / Corrections

- The red baseline showed unknown/unavailable labels were concealed and unknown diff extensions still reached OpenTUI as parser hints. Both now fail closed before renderer construction.
- Focused cross-surface tests passed but inherited Tree-sitter destruction warnings remained. A broader drain loop in the shared teardown helper did not remove them and was reverted to avoid an ineffective out-of-scope change.
- Full coverage exposed an import-side-effect fixture whose `syntaxParsers.ts` mock exported only `registerSyntaxParsers`; adding the new runtime resolver made that child import invalid. The fixture now includes an inert resolver export while preserving its original no-registration assertion.
- Final verification is passing but not warning-clean: `bun test --coverage` completed with 1,935 passed, 3 skipped, 0 failed and task source files above 99% line coverage; the canonical typecheck/test gate, self-check, and compiled build also pass.
- `src/ui/HandoffPreview.test.tsx` independently reproduces OpenTUI `TreeSitter client destroyed` teardown warnings with 37 passed and 0 failed. Because `cy-final-verify` requires zero warnings, task tracking remains pending and no automatic commit is allowed.

## Ready for Next Run
