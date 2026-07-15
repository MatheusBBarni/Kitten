# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the same-binary `--ask-user-mcp` stdio child, strict bounded one-tool schema, authenticated bridge client, terminal outcome serialization, and process-mode coverage without changing normal boot.

## Important Decisions

- Reuse task_04's JSONL envelope and exported bridge limits/env names; keep all MCP SDK and wire handling in `src/agent/askUserMcp.ts`.
- Reject unknown MCP input keys (including caller timeout or session identity) before opening IPC; return only fixed content-free error categories.
- Keep the strict Zod schema as the advertised MCP input schema; SDK validation diagnostics are tested to exclude submitted content, while authorization/transport failures collapse to fixed `invalid_request`, `unavailable`, or `busy` categories.
- Export bridge env names, the reserved flag, and shared size/count limits from the agent adapter so the parent and child cannot drift.

## Learnings

- The pre-change baseline has no `src/agent/askUserMcp.ts`, no MCP SDK dependency, and no child dispatch in `src/index.ts`.
- The prerequisite bridge accepts `{kind:"ask", callId, capability, form}` and returns correlated `result` or fixed-category `error` JSONL frames.
- Spawned-process execution is outside Bun's in-process coverage accounting; direct IPC and injected-transport tests are required to prove the child module's 80% threshold locally.

## Files / Surfaces

- Planned: `package.json`, `bun.lock`, `bunfig.toml`, `src/index.ts`, `src/agent/askUserMcp.ts`, colocated/unit and process integration tests, dependency/boot contract tests.
- Touched: `src/app/askUserBridge.ts` now consumes and re-exports the child-owned wire constants; task-local coverage currently reaches 92% functions and 94% lines for `askUserMcp.ts`.

## Errors / Corrections

- The first coverage run failed at 75% functions / 83.81% aggregate lines because the real spawned child was not instrumented in the parent; added in-process socket parser and transport-close coverage, then reran above threshold.
- A Zod `.catch()` experiment made SDK errors fully uniform but erased the advertised JSON schema; reverted it and added an assertion that the published schema retains required fields, strict unknown-key rejection, and item bounds.
- Fresh full `bun run typecheck && bun test` remains blocked only by the two pre-existing `test/releaseWorkflow.test.ts` token-policy assertions (11 pass, 2 fail in the isolated file); task-local coverage, self-check, and local compiled build pass.

## Errors / Corrections

## Ready for Next Run

- Implementation and self-review are ready, but task status/checklists and automatic commit must remain pending until the repository-wide gate is clean.
- Fresh evidence: task coverage 26 pass with `askUserMcp.ts` at 92.11% functions / 94.82% lines; `SELF-CHECK OK`; host build produced `dist/kitten-darwin-arm64` with SHA256 `833c66bb647a0bab564b410b867af603d507402a1ef3b4920eca13a5169a8f97`.
