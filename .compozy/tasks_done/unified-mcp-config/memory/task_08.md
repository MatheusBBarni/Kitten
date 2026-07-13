# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Build the ADR-005 real-subprocess adapter-honor release gate, its one-tool stdio MCP fixture, dedicated script, and fixture coverage.

## Important Decisions

## Learnings

## Files / Surfaces

## Errors / Corrections

- 2026-07-12 pre-edit grounding found task_04 marked `completed` in its task file while the required source dependency is absent: `AgentConnection.newSession` still accepts only `cwd` and sends `mcpServers: []`.
- The task and ADR-005 require `codex-acp@1.1.0`, but the live pinned constant in `src/config/configLoader.ts` is deliberately committed as `codex-acp@1.1.2` (`81d6fbc`). The task also says to use that live constant, so the requested adapter version is internally inconsistent.
- No implementation began because `cy-execute-task` requires stopping on requirement/TechSpec/ADR conflicts rather than guessing.

## Ready for Next Run

- Resolve whether task_08 must test the current live Codex pin (`1.1.2`) or restore/test the documented `1.1.0`.
- Ensure task_04 implementation is present before task_08 resumes, or explicitly authorize task_08 to bypass `AgentConnection` and drive `ClientSideConnection` directly.
