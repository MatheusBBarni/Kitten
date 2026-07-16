# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Prove lifecycle-complete generated MCP composition with real stdio and fake-ACP integration across fresh, dynamic, restored, replaced, failed, closed, and disposed generations.

## Important Decisions

- Reused the controller and bridge implementation delivered by tasks 01-05; task 06 adds end-to-end contract evidence rather than a second lifecycle path.
- Kept real stdio coverage in `test/askUserMcp.integration.test.ts` and real ACP wire/lifecycle coverage in `test/orchestration.integration.test.ts`.
- Two-provider ownership checks sequence calls within one route while still exercising the two distinct provider routes concurrently.

## Learnings

- A generated bridge route accepts one bound socket at a time. Tests issuing own-child and cross-child polls through the same capability must sequence those connections; different provider routes can run concurrently.
- Fake ACP child prompts require a certified harness profile because the controller's first child prompt uses the normal harness-delivery path.

## Files / Surfaces

- `test/askUserMcp.integration.test.ts`: both bundled tools over real stdio, authenticated agent-run start, distinct provider capabilities, user MCP ordering, and cross-owner poll rejection.
- `test/orchestration.integration.test.ts`: four real fake-ACP child connections covering running, needs-input, finished, failed, visible workspace projection, exact polling, and stale route rejection.

## Errors / Corrections

- Initial four-child fixture omitted harness certification, so normal first-prompt dispatch failed closed for all children. Added the same certified-profile seam used by production-shaped ACP integration tests.
- Initial same-route poll calls raced the bridge's single bound socket. Split them into sequential per-route rounds.

## Ready for Next Run

- Task implementation, self-review, tracking, and verification are complete. Isolated coverage, the full typecheck/test gate, and the compiled host build pass.
- Scoped integration evidence was committed locally as `05ace6d` (`test: cover agent-run lifecycle integration`); tracking and workflow-memory files intentionally remain outside the commit.
