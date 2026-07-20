# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implement the controller/application-owned bounded materializer for full files, inclusive line slices, and staged/unstaged per-path diffs, returning content only after containment and source-fence checks.

## Important Decisions

- Source identity uses the host file's stable `dev`/`ino` pair, namespaced by artifact kind (and diff scope). Artifact byte length covers exact returned bytes; full-file and slice SHA-256 fences cover the whole backing file so edits outside a slice still become stale, while diff SHA-256 covers the exact fixed-command output.
- Line slices are 1-based and inclusive, preserve original line endings, and reject ranges outside the current source without rebasing.
- Diff reads use one fixed `git --no-pager --literal-pathspecs diff --no-ext-diff --no-textconv --no-color ... -- <path>` command shape and never accept caller-supplied command arguments or pathspec expansion.
- Default limits are fixed in the application boundary and can only be tightened through validated numeric limit overrides for tests/callers.

## Learnings

- `src/core/types.ts` and `src/core/contextPack.ts` already provide metadata-only selections and `MaterializedContextArtifact`; Task 05 needs bounded-read and typed blocked/stale result contracts around those existing values, not a second artifact model.
- `src/app/fileDiscovery.ts` already owns the repository-relative path, realpath-containment, and NUL-prefix binary policy; expose and reuse those helpers instead of duplicating them.
- Git's `--` separator does not disable pathspec magic by itself; fixed diff reads also need global `--literal-pathspecs` so one metadata path cannot expand to multiple repository paths.
- Slice freshness requires hashing the whole backing file even though `source.bytes` remains the exact returned slice byte count expected by candidate assembly.

## Files / Surfaces

- Added `src/app/contextPackMaterializer.ts` and `src/app/contextPackMaterializer.test.ts`.
- Added `test/contextPackMaterializer.integration.test.ts` for a real temporary Git workspace.
- Updated `src/app/fileDiscovery.ts` / `.test.ts` to export and lock one safe-relative-path, realpath-containment, binary-prefix, and `.git` control-path policy.
- Updated `src/core/types.ts` with protocol-free bounded-read, limit, materialized, blocked, and stale contracts; preserve unrelated Cursor recovery edits already present in that file.

## Errors / Corrections

- Pre-change targeted test baseline exits 1 because `src/app/contextPackMaterializer.test.ts` does not exist.
- Self-review added `--literal-pathspecs`, rejected `.git` control paths, and required the shared binary-prefix policy to inspect a diff's addressed source before Git runs.
- Initial slice hashing covered only returned lines; corrected it to hash the whole backing file while retaining exact slice byte accounting, so any source edit invalidates the fence.
- Task-owned unit/integration tests pass (22 tests), typecheck passes, and full isolated coverage passes with 2,696 tests, 0 failures; materializer coverage is 96.55% functions / 96.53% lines.
- The required non-isolated `bun run typecheck && bun test` gate failed twice on the same unrelated `src/ui/Markdown.test.tsx` capability-registration test (2,695 pass / 1 fail each run). That test passes alone (1/1) and its full file passes alone (40/40). Do not mark Task 05 complete or commit until the exact broad gate is clean.

## Ready for Next Run

- Implementation and task-scoped evidence are ready for review, but task tracking remains pending and no automatic commit was created because the exact repository gate is red on the inherited Markdown/OpenTUI isolation failure.
- Resume by reconciling or separately resolving the full-suite Markdown capability-registration leak, then rerun `bun run typecheck && bun test`; only after a clean run update Task 05 checkboxes/status and create the narrow local commit.
