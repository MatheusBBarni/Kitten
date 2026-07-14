# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Replace the singleton TypeScript self-check with manifest-driven Markdown and extension-backed diff evidence, plus an explicit unknown-label plaintext control, and prove the same matrix in the host binary.

## Important Decisions

- Keep fixture labels, source snippets, expected tokens, and diff extensions in `syntaxParserManifest`; self-check derives its matrix from that contract instead of maintaining a second language list.
- Model foreground evidence per canonical capability, declared label, and surface so failures can be actionable without including fixture source or token content.

## Learnings

- Baseline `bun run selfcheck` is green but prints only `compiledMarkdownToken` and `compiledDiffToken`, confirming the release assurance path still covers only TypeScript.
- The manifest currently yields 23 supported Markdown label fixtures and 7 extension-backed diff fixtures; the real and compiled self-checks render all 30 plus one unknown-label plaintext control.
- Fresh coverage is 97.16% functions / 98.11% lines overall and 87.30% / 87.46% for `src/app/selfCheck.ts` (1,936 pass, 3 opt-in skips, 0 failures).

## Files / Surfaces

- `src/ui/syntaxParsers.ts` and its test: fixture source snippets and globally unique highlighted evidence tokens.
- `src/app/selfCheck.ts`, `src/ui/main.tsx`, and `src/index.ts`: manifest-derived Markdown/diff collections, all-renderable settling, capability-aware assertions, unknown plaintext control, and compiled fault injection.
- `src/app/selfCheck.test.ts`, `test/firstRunBoot.test.ts`, `test/index.integration.test.tsx`, and `test/build.integration.test.ts`: matrix assertions, import-side-effect mock compatibility, compiled token parity, CLI contracts, and injected missing-evidence failure.

## Errors / Corrections

- Real self-check initially failed OCaml Markdown evidence because uppercase value identifiers were default-colored; changed OCaml fixture identifiers to valid lowercase value names in the manifest.
- Full coverage isolated an entry-import subprocess mock that omitted the newly consumed manifest export; extended the mock with an empty manifest while retaining its zero-registration assertion.

## Ready for Next Run

- Implementation and focused/coverage/compiled checks pass. Do not mark tracking complete or commit yet: the fresh full gate exits 0 but emits inherited `TreeSitter client destroyed` warnings from unrelated UI teardown tests, which fails the `cy-final-verify` zero-warning commit requirement.
- Fresh final command: `bun run typecheck && bun test && bun run selfcheck && bun run build`; results were 1,936 pass, 3 opt-in skips, 0 failures, `SELF-CHECK OK`, and host binary/checksum build success.
