# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

## Shared Learnings

## Open Risks

- The repository-wide non-isolated test run can still fail `src/ui/Markdown.test.tsx` at “registers capabilities on a direct multi-block mount before code rendering” with a 20-pass frame-predicate timeout. It reproduced in consecutive final runs while the same file passed 40/40 in isolation; task-local Cursor suites and isolated coverage remained green.

## Handoffs
