# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

## Shared Learnings

- Real-adapter tests that send a fresh first prompt must provide both a controller-supported capability and an adapter-side exact matching certified profile; injecting only one side correctly fails closed.

## Open Risks

- The repository-wide `bun test` gate currently fails two unrelated `test/releaseWorkflow.test.ts` assertions because the tracked release workflow contains `NODE_AUTH_TOKEN` / `secrets.NPM_TOKEN`; harness-delivery tasks must not claim a clean full gate until that release-workflow mismatch is resolved.

## Handoffs
