# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add one content-free native Cursor live-config outcome while preserving the adapter as the only ACP request boundary.

## Important Decisions

- Keep `AgentConnection.setSessionConfigOption` production behavior unchanged: current ACP documentation and the implementation both return the agent-confirmed full option snapshot.
- Capture the session's advertised protocol-free options from the existing `config_options` event, then probe only the first `visibleConfigOptions` entry with its current advertised value before the synthetic prompt.
- Store the probe result as one `configCapability` enum value on certification evidence; a rejected request is contained as `rejected` so prompt and disposal still proceed.

## Learnings

- `startMockAgent` previously shallow-copied only the config-options array, so successful updates mutated caller-owned option objects across tests. Deep-cloning the scripted snapshot is required to prove rejection preserves prior state deterministically.

## Files / Surfaces

- Touched: `test/cursorAcp.contract.test.ts`, `src/agent/agentConnection.test.ts`, and `test/mockAgent.ts`.

## Errors / Corrections

- The worktree already contains unrelated uncommitted changes in `src/agent/agentConnection.test.ts` and other files. Preserve them and stage only task-owned hunks.
- First focused run failed because the strengthened rejection test referenced the mock handle without destructuring it; corrected the test fixture binding before rerunning.
- The next focused run showed `startMockAgent` leaking successful config mutation into shared fixtures because of a shallow copy; changed the mock to deep-clone its scripted option snapshot.
- The canonical non-isolated gate reproduced one out-of-scope Markdown capability-registration failure twice (2,559 passed, 4 opt-in skips, 1 failed each run). `src/ui/Markdown.test.tsx` passes 40/40 alone, and the full isolated coverage run passes, so completion and automatic commit remain blocked pending a clean canonical gate.

## Ready for Next Run

- Implementation and self-review are complete in `test/cursorAcp.contract.test.ts`, task-owned config-option assertions in `src/agent/agentConnection.test.ts`, and `test/mockAgent.ts`.
- Fresh focused gate: 95 passed, 1 opt-in skip, 0 failed. Fresh enforced coverage: 2,560 passed, 4 opt-in skips, 0 failed; 97.20% functions and 98.23% lines.
- Do not mark task tracking complete or commit until `rtk bun run typecheck && rtk bun test` exits 0. Preserve the unrelated pre-existing hunks in `src/agent/agentConnection.test.ts` when staging.
