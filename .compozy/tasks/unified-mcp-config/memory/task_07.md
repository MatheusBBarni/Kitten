# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Harden all MCP warning, error, and telemetry emission points so resolved server env secrets never reach emitted output while telemetry remains counts plus reason categories only.

## Important Decisions

- Treat `_techspec.md` Monitoring and Observability plus ADR-004 as the emission contract: MCP telemetry is content-free and any potentially secret-bearing text is redacted at the boundary.

## Learnings

- The active branch contains task 01 and task 02 source commits only. Task 04/05/06 files are marked completed in the dirty worktree, but their required source changes are absent.

## Files / Surfaces

- Inspected `src/app/controller.ts`, `src/agent/agentConnection.ts`, `src/telemetry/recorder.ts`, and MCP config/resolver sources; no task-05 MCP emission seam exists yet.

## Errors / Corrections

- Blocked before source edits: `AgentConnection.newSession` still accepts only `cwd`, ACP requests still send `mcpServers: []`, and the controller has no MCP provisioning/readout or warning path. Task 07 cannot satisfy its required integration test without expanding into missing dependency work.

## Ready for Next Run

- Resume task 07 after task 04 and task 05 source commits are present on this branch, then re-run emission-point discovery against the actual controller and telemetry seams.
