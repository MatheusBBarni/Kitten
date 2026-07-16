# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Define and register the bounded public `agent_run` start/poll adapter contract while leaving route authorization and lifecycle ownership to later bridge/controller tasks.

## Important Decisions

- Start task/outcome text is non-whitespace and capped at 4 KiB per field; child IDs are non-whitespace and capped at 128 bytes; every local frame reuses the existing 64 KiB bridge bound.
- The strict discriminated union remains the authoritative input parser. An object-shaped MCP publication envelope converts SDK-side validation failures into sentinels so the handler returns only `invalid_request` instead of verbose validation details.
- Successful local replies use a correlated `agent_run_result` frame and are allowlist-validated before serialization; poll replies must match requested IDs in exact order.

## Learnings

- MCP SDK 1.29.0 publishes a top-level Zod discriminated union as an empty object. Object-shaped field-level catch schemas retain advertised bounds while letting the handler own generic error serialization.
- Runtime child mode needed the new registrar in `dispatchReservedChildMode`; the existing same-binary integration therefore needed its tool-list assertion updated from one tool to both tools.

## Files / Surfaces

- Added `src/agent/agentRunMcp.ts` and `src/agent/agentRunMcp.test.ts`.
- Modified bundled composition coverage and runtime registration in `src/agent/kittenMcp.test.ts`, `src/index.ts`, and `test/askUserMcp.integration.test.ts`.

## Errors / Corrections

- Direct MCP registration of the strict union advertised `{ type: "object", properties: {} }`; replaced it with a schema-compatible publication envelope while retaining strict handler parsing.
- The first full gate correctly failed the stale one-tool same-binary assertion; that assertion now expects `ask_user` followed by `agent_run`.
- The same full run also hit the known `Markdown.test.tsx` direct-mount renderer timeout; fresh full verification remains required after the contract assertion correction.
- The renderer timeout passed immediately in isolation and in the fresh full verification run; no source correction was needed.

## Ready for Next Run

- Implementation, verification, self-review, and tracking are complete. Scoped local commit: `9a422c3` (`feat: add strict agent_run MCP contract`).

## Verification Evidence

- Focused adapter set: 57 passed, 0 failed; overall 97.40% functions / 98.55% lines, with `agentRunMcp.ts` at 97.30% functions / 99.20% lines.
- Final full gate: typecheck passed; 2,401 tests passed, 4 credentialed/manual skips, 0 failed; self-check reported `SELF-CHECK OK`.
