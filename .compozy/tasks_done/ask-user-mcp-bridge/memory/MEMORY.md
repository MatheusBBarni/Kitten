# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

## Shared Learnings

## Open Risks

- The repository-wide `bun run typecheck && bun test` gate is not clean as of task_04: `test/releaseWorkflow.test.ts` deterministically rejects the checked-in release workflow's `NODE_AUTH_TOKEN` / `secrets.NPM_TOKEN`, and the same full run cascades into OpenTUI blank-frame/time-out failures. Ask-user task-local gates can pass while this unrelated broad gate remains blocked.

## Handoffs
