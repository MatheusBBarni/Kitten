# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the fail-soft, async git branch reader and its unit plus real-repository tests; task 09 remains responsible for invoking it at boot and turn boundaries.

## Important Decisions

- Expose a display-ready `string | null`: an attached branch name, the detached short SHA, or `null` on any failure. This follows the task contract; ADR-007's object-shaped implementation note is not needed by any current caller.
- Keep the spawn boundary injectable and default it to `Bun.spawn`, with no render/controller import in this task.

## Learnings

- The pinned Bun typings model piped subprocess output as `ReadableStream<Uint8Array>` without a `.text()` method; decode with `new Response(stream).text()` even though newer Bun docs show the convenience method.
- Focused coverage reports 100% functions and 100% lines for `src/config/gitBranch.ts`; the real temporary-repository test checks the default `Bun.spawn` path.

## Files / Surfaces

- Added `src/config/gitBranch.ts` and `src/config/gitBranch.test.ts`. No render, controller, reducer, or store file imports the reader; task 09 owns invocation.

## Errors / Corrections

- Initial typecheck rejected `.text()` on piped Bun streams. Production and test setup were corrected to standards-compatible `Response` decoding; focused tests and typecheck then passed.
- Full `bun run typecheck && bun test` exits 0 with 789 passing tests, but emits the existing React `act(...)` and `ModelSelect` listener warnings recorded in shared memory. `cy-final-verify` therefore blocks completion tracking and the automatic commit.

## Ready for Next Run

- Implementation and task-specific validation are ready. Leave `task_07.md` pending and uncommitted until the repository-wide gate is warning-free or the completion policy changes.
