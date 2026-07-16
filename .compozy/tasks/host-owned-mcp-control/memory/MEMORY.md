# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

## Shared Learnings

- MCP SDK 1.29.0 reduces a top-level Zod discriminated union passed to `registerTool` to an empty published object schema. Keep the strict union as the authoritative parser and use an object-shaped publication envelope when bundled tools need structured schema advertisement plus generic handler-owned errors.

## Open Risks

## Handoffs
