# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the pure domain-to-ACP stdio MCP translator and its focused unit coverage.

## Important Decisions

- Treat commands and env values as already resolved by task 02; this translator performs shape mapping only.
- Preserve server order and JavaScript object entry order for env variables.

## Learnings

- ACP SDK 1.2.1 models stdio MCP servers without a `type` discriminator and requires `env: EnvVariable[]`.
- Full coverage passed at 97.00% functions / 98.23% lines overall; `src/agent/acpTranslate.ts` was 100% functions / 100% lines.

## Files / Surfaces

- `src/agent/acpTranslate.ts`
- `src/agent/acpTranslate.test.ts`

## Errors / Corrections

- Focused coverage ran all 31 translator tests and reported `acpTranslate.ts` at 100% functions/lines, but exited 1 because the same test file imports partially exercised `sessionReducer.ts`, lowering the aggregate focused-run coverage below the repository threshold. Use the full coverage suite for the repository-level gate.
- Initial full typecheck rejected direct `.env` access on the `McpServer` union in the empty-env test. Compare the full stdio output shape instead; the production translator already matched the SDK contract.

## Ready for Next Run

- Task 03 is implemented and verified. Task 04 can import `toAcpMcpServers` when widening `AgentConnection.newSession` and owns the in-memory transport contract test.
