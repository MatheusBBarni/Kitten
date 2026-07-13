# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Thread the one global MCP resolution result through controller startup and expose identical per-agent loaded/skipped readouts.

## Important Decisions

## Learnings

## Files / Surfaces

## Errors / Corrections

- 2026-07-12: Execution is blocked before source edits because dependency task_04 is tracked as completed in the dirty worktree, but `AgentConnection.newSession` still accepts only `cwd`, still sends `mcpServers: []`, and no `toAcpMcpServers` translator is present. Completing task_05 now would require silently absorbing tasks 03 and 04.

## Ready for Next Run

- Resume after tasks 03 and 04 are implemented and verified, or after explicit authorization to expand this run to repair those dependencies.
