# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

## Shared Learnings

## Open Risks

- The public npm package named `kitten` currently resolves to an unrelated Octopress exporter. Showcase tasks must keep the source checkout as the sole promoted install route until a Kitten-owned package or release installer is publicly verified; Task 08 must reconcile the conflicting README CTA before launch.

## Handoffs

- Task 02 centralizes repo metadata, the sole source-install route, proof fallbacks, a11y copy, and released product claims in `site/src/config/showcase-config.ts`; Tasks 03 and 05 should consume that contract instead of recreating constants.
