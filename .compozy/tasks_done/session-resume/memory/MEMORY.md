# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

## Shared Learnings

## Open Risks

- The current repository-wide verification surface is not clean: full tests emit pre-existing OpenTUI `theme_mode` listener warnings, and `bun test --coverage` can terminate with Bun signal 5 after UI tests. Treat this as a commit/tracking blocker until a warning-free coverage/full gate is available.
- Task 05's 2026-07-11 real reload probe confirmed Codex, but Claude could not reach the reload step because organization policy disabled Claude Code subscription access. Re-run with an Anthropic API key or enabled admin policy before treating the Claude side of the Phase-1 gate as verified.

## Handoffs
