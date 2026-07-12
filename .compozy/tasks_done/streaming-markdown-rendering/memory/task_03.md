# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Preserve Kitten's single-binary distribution while making OpenTUI 0.4.3 Markdown fences and diffs provably highlighted in `--self-check`.

## Important Decisions

- The offline controller correctly routes its focused pane to a not-ready explanation, so the self-check mounts the production `Markdown` and `ToolCallDiffView` leaves as `CockpitApp`'s injected main-region child instead of mutating transcript state. This preserves the real cockpit shell/status/name frame while making both syntax surfaces visible.
- `CockpitApp` suppresses even injected children behind its readiness gate; the self-check therefore uses a process-free connection that reports a synthetic successful handshake/session. It still launches no agent process but exercises the normal ready content path.
- The validated Bun 1.3.13 recipe is a second compile entrypoint for `node_modules/@opentui/core/parser.worker.js` plus stable `[name].[ext]` entry naming. Bun embeds that worker and its `web-tree-sitter` wasm; OpenTUI's main graph embeds the configured language wasm/scm files. Startup extracts only the worker JS to a digest-named user cache and leaves parser assets on BunFS.

## Learnings

- Baseline probe exits 1: `scripts/build.ts::compileCommand` has no `parser.worker.js` entry, so the worker is not traced into the standalone binary.
- OpenTUI's main bundle already imports the configured language wasm/scm assets with Bun file attributes; the missing boundary is the worker entry, whose own bundle also imports `web-tree-sitter/tree-sitter.wasm`.
- `OTUI_TREE_SITTER_WORKER_PATH` is resolved when the singleton `TreeSitterClient` is constructed, so Kitten must set it before mounting any Markdown/diff renderable.
- Red/green host evidence: the strengthened self-check made the old compiled command exit 1; after adding the worker entry, `test/build.integration.test.ts` exits 0 with 1 passing test and 6 assertions.
- Final host build evidence: `bun run build:local` produced `dist/kitten-darwin-arm64`; its direct `--self-check` exited 0, printed both syntax tokens, `Claude Code`, and `SELF-CHECK OK`. The extracted worker is a single 192.1 KB digest-named cache file.
- Fresh full coverage exits 0 with 970 tests, 97.32% functions and 98.70% lines. Changed files: `selfCheck.ts` 96.43% functions/98.00% lines and `treeSitterWorker.ts` 87.50% functions/100% lines.

## Files / Surfaces

- Touched: `scripts/build.ts`, `test/build.test.ts`, `src/index.ts`, `src/app/treeSitterWorker.ts`, `src/app/treeSitterWorker.test.ts`, `src/app/selfCheck.ts`, `src/app/selfCheck.test.ts`, `src/ui/main.tsx`, `test/firstRunBoot.test.ts`, and `test/build.integration.test.ts`.
- `package.json` `build:local` now delegates to `scripts/build.ts`; otherwise the documented host-build command would bypass `compileCommand` and silently reintroduce the missing worker.

## Errors / Corrections

- First focused typecheck found that Bun exposes `embeddedFiles` as `Blob[]` without a typed `name` and that a test assertion did not narrow `string | null`; use a local structural name helper and explicit guard. The six runtime unit tests were already green.
- The first real self-check fixture timed out because offline sessions intentionally show the not-ready pane rather than `ConversationView`; moved the syntax fixture to the cockpit's supported injected-children seam.
- The first plain full-suite gate had one flaky existing Markdown heading test fail (969 pass, 1 fail); it passed alone. Because the strengthened self-check now creates the global tree-sitter client, its cleanup captures and awaits that client's destruction after renderer teardown so later tests cannot inherit a half-destroyed singleton.
- After the lifecycle correction, fresh `bun test` exits 0 with 970 pass/0 fail. It still emits repository-wide `theme_mode` listener and destroyed tree-sitter warnings. `git diff --check` also reports pre-existing trailing whitespace in dirty snapshot files unrelated to task 03. Under the warning-free final gate, task status/checklists remain pending and no automatic commit is allowed.

## Ready for Next Run

- Implementation and task-specific verification are ready in the working tree. Before completion/commit, eliminate or otherwise obtain a genuinely warning-free repository-wide gate, rerun typecheck, full tests, coverage, source self-check, and compiled host self-check, then update `task_03.md` tracking.
- Do not stage the entire overlapping files blindly: this worktree contains extensive pre-existing edits, including in `src/index.ts`, `src/ui/main.tsx`, and `test/firstRunBoot.test.ts`.
