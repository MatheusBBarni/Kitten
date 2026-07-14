# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Authenticate only resolved `cursor-certified` runtime profiles inside `src/agent/`, after initialize and before session creation; normalize authentication failures without leaking ACP types.

## Important Decisions

- Preserve generic initialize failures as legacy `{ ready: false, error }`; use the optional `authentication_required` discriminator only for the profile-directed authentication phase.
- Normal coverage stays on the in-process ACP mock; real credentialed Cursor execution remains task 08 scope.

## Learnings

- ACP SDK 1.2.1 exposes initialize methods as `authMethods[].id` and client authentication as `authenticate({ methodId })`; the in-process `AgentSideConnection` preserves the required wire ordering.
- Focused adapter coverage reports 97.32% lines for `agentConnection.ts`; the focused command exits nonzero only because the repository threshold is applied to the separately loaded transport module, so the full coverage suite is the authoritative task gate.

## Files / Surfaces

- Touched `src/agent/agentConnection.ts`, `src/agent/agentConnection.test.ts`, and `test/mockAgent.ts` only.

## Errors / Corrections

- Added an explicit advertised-but-unavailable RPC case after the first focused pass; missing advertisement and RPC method rejection are distinct failure modes.
- The parent shell exported both `NO_COLOR` and `FORCE_COLOR`, producing an inherited color warning; the final pre-commit gate removed only `FORCE_COLOR` from the child environment and completed warning-free.

## Ready for Next Run

- Task implementation and self-review are complete. Fresh gates: `bun run typecheck && bun test` exited 0 with 1,694 pass, 2 opt-in skips, and 0 failures; `bun run test:coverage` exited 0 with the enforced threshold satisfied.
- No shared-memory promotion: the authentication contract is already captured by the TechSpec/ADR and the code now makes the behavior discoverable.
