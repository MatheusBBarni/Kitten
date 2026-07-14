# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add strict resolved and persisted statusline configuration, atomic field-level patches, and symlink-target rejection with loader/writer coverage.

## Important Decisions

- Reuse `normalizeStatuslineLayout` as the authoritative saved-layout validator; the nested Zod block owns only disclosure typing, strict keys, and paired optional layout fields.
- Merge a statusline patch field-by-field so acknowledgement-only persistence cannot erase an existing saved layout.
- Check the target with `lstat` before the writer reads it and again immediately before atomic replacement; an existing symlink is a hard `ConfigError`.

## Learnings

- Task 01 is committed at `fe6eefb` and provides the pure statusline contract used by this task.
- The pre-change loader rejects the root `statusline` key as unrecognized, proving task 02 is not implemented.
- Explicit `AppConfig` fixtures across controller/UI/integration tests require the new resolved preference; defaults-based fixtures inherit it automatically.
- Focused coverage includes unrelated imported modules, so its aggregate is below threshold even though task-owned `configLoader.ts` and `configWriter.ts` report 100% and 90.67% line coverage respectively; use the repository coverage gate for the enforced aggregate.
- Repository-wide coverage passed with 98.16% lines; the final full gate passed 1,818 tests with 0 failures, `SELF-CHECK OK`, and a successful host build.

## Files / Surfaces

- Touched: `src/core/types.ts`, config loader/writer and colocated tests, plus explicit `AppConfig` fixtures in controller, config, UI, and integration tests.

## Errors / Corrections

- The worktree contains unrelated Cursor/default-model/task-tracking changes; preserve them and stage only task 02-owned hunks/files.
- Initial typecheck failed because fourteen explicit `AppConfig` fixtures lacked the required field; migrated those fixtures and restored a clean typecheck.
- Hardened reads beyond the initial `lstat` decision by opening with `O_NOFOLLOW`, closing the descriptor in `finally`, and retaining a second target check before rename.

## Ready for Next Run

- Task 02 is implemented and freshly verified. Later tasks can consume required `AppConfig.statusline`, acknowledgement-only/full-layout writer patches, and loader/watcher reloads without changing this persistence boundary.
- Workflow memory has no durable non-obvious cross-task fact to promote; the public contracts are already explicit in source and TechSpec.
