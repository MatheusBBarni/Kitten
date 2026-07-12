# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

## Shared Learnings

## Open Risks

- The repository-wide pre-commit gate currently emits existing React/OpenTUI test-harness warnings outside this workflow: `runSelfCheck` reports an update outside `act`, several UI suites report excess `theme_mode` listeners, and an OpenTUI teardown can report a destroyed TreeSitter client. Tests exit 0, but `cy-final-verify` requires a warning-free gate before automatic commits.

## Handoffs
