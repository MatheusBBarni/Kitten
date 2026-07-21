# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

## Shared Learnings

## Open Risks

- The repository-wide `bun test --coverage --isolate` gate currently exits 1 because untouched `src/agent/transport.ts` has 76.47% function coverage against the per-file 80% threshold, even though all runnable tests pass and aggregate coverage exceeds 80%. Do not mark workflow tasks complete or auto-commit until this inherited gate is resolved or the caller explicitly changes the required gate.

## Handoffs
