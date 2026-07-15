# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the sole pure V1 harness-prompt renderer and its complete contract evidence without changing delivery or user-visible paths.

## Important Decisions

- Use the reviewed PRD envelope verbatim and fixed `<kitten_harness_fragment id="...">` envelopes separated by two LF characters.
- Treat stable block IDs as at least two lowercase alphanumeric dot-separated segments; reserve every `base.*` ID.
- Count deterministic whitespace tokens after outer-whitespace normalization and before fragment escaping.
- Sort block IDs with direct string comparison so canonical order does not depend on locale behavior.

## Learnings

- A source-boundary assertion must inspect imports and executable runtime access patterns rather than matching forbidden vocabulary in explanatory comments.

## Files / Surfaces

- Added `src/core/harnessPrompt.ts` and `src/core/harnessPrompt.test.ts`; no adapter, app, config, persistence, telemetry, or UI surface is in scope.

## Errors / Corrections

- The first focused run had 34 passing tests and one false-positive purity assertion because the production comment named absent persistence; narrowed the assertion to imports and runtime API access.
- The first repository gate stopped at typecheck because the test rejection fixture widened literal fields to `string`; typed it against the production rejected-result union before rerunning the full gate.
- A fresh post-change full gate typechecked but ended with 1,988 pass, 3 skip, and 2 unrelated failures in `test/releaseWorkflow.test.ts`; an isolated rerun reproduced both because the tracked release workflow contains `NODE_AUTH_TOKEN`/`secrets.NPM_TOKEN` while its tests forbid them. Neither release file has a task diff.

## Ready for Next Run

- Implementation and focused evidence are ready, but task status and all checkboxes must remain pending until the repository-wide gate is clean; do not auto-commit while the release-workflow failures remain.
