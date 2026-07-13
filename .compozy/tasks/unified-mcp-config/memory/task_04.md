# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Widen `AgentConnection.newSession` to accept already-resolved MCP servers, translate them through task_03's adapter helper, update fakes, and prove the ACP request shape over the in-memory transport.

## Important Decisions

## Learnings

## Files / Surfaces

## Errors / Corrections

- Blocked before source edits on 2026-07-12: dependency task_03 is still pending and `toAcpMcpServers` is absent from `src/agent/acpTranslate.ts` and the repository. The task_04 workflow must resume after task_03 lands; do not duplicate task_03 inside this task.

## Ready for Next Run

- Recheck that task_03 is completed and exports `toAcpMcpServers`; then resume from the captured baseline where `AgentConnection.newSession(cwd)` still sends a hardcoded `mcpServers: []`.
