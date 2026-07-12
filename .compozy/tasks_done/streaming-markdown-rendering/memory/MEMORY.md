# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

## Shared Learnings

## Open Risks

- On Bun 1.3.13 with OpenTUI 0.4.3, repository-wide UI test/coverage runs can emit `theme_mode` listener, React `act`, and destroyed tree-sitter warnings, then segfault at address `0x5` with exit 133. Do not treat a narrow green run as a clean completion gate; future tasks need a fresh warning-free full run before completion or commit.

## Handoffs
