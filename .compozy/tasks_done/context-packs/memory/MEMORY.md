# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

## Shared Learnings

- Context Build child connections must disable direct ACP filesystem handlers (`fileSystemAccess: "none"`); otherwise the ordinary AgentConnection read/write callbacks bypass the bounded, generation-bound Context Pack bridge.

## Open Risks

## Handoffs
