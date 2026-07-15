# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

## Shared Learnings

## Open Risks

- The repository-wide test gate currently fails two committed `test/releaseWorkflow.test.ts` token-free publishing assertions because `.github/workflows/release.yml` still declares `NODE_AUTH_TOKEN` from `secrets.NPM_TOKEN`; later tasks must not claim a clean gate until that unrelated mismatch is resolved.
- In the same full-process run, the release failure is followed by `TreeSitter client destroyed`; later OpenTUI suites then render blank canvases and inflate the result to 211 failures. Use isolated focused runs for feature diagnosis, but do not treat them as a clean repository gate.

## Handoffs
