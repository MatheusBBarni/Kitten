# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Expose the completed standalone update service through the compiled `--update` path before self-check and normal boot, with terminal and exit semantics covered in-process and through a real host artifact.

## Important Decisions

- Keep `dispatchCliFlags` synchronous and metadata-only; compose it with a separate injectable async update dispatcher so version/help precedence is directly testable.
- Write one formatted outcome plus its trailing newline through one output call; map updated/already-current to exit 0 and refused/failed/runner exceptions to exit 1.
- Keep public help unchanged in this task so the private installer-record mode and Task 06 documentation scope remain separate.

## Learnings

- The pre-change executable module exports no `wantsUpdate` recognizer (`wantsUpdate=undefined`), confirming the public compiled update route is absent.
- The completed entry boundary preserves private installer recording and reserved MCP child modes ahead of version/help/update dispatch, while update remains ahead of self-check and normal boot.
- The isolated compiled-artifact test proves an unregistered target refuses without changing its bytes, mode, or registry and without emitting self-check, repository-gate, agent, or Cockpit output.

## Files / Surfaces

- Changed: `src/index.ts`, `test/firstRunBoot.test.ts`, and `test/build.integration.test.ts`.
- Tracking-only: `.compozy/tasks/channel-preserving-update/task_04.md` and this task-memory file.

## Errors / Corrections

- The first full coverage gate had 2,884 passing tests and 96.43%/97.96% overall coverage, but failed because `src/index.ts` function coverage was 79.59%; direct coverage for the production stdout/exit defaults raised it to 81.63% functions and 91.96% lines without changing the threshold.
- Fresh full coverage now has 2,885 passing tests, 5 intentional skips, 0 failures, and 96.45%/97.96% overall coverage, but still exits 1 because unrelated unchanged `src/agent/transport.ts` remains below the per-file function floor at 76.47%. The task-owned entrypoint is above 80%, so this was recorded rather than expanded into adjacent transport work.
- Fresh `bun run typecheck && bun test && bun run selfcheck && bun run build:local` passes, including 2,885 tests, `SELF-CHECK OK`, and the host artifact build.

## Ready for Next Run

- Resolve or explicitly accept the inherited `src/agent/transport.ts` coverage-floor blocker, rerun `bun run test:coverage`, then mark the task completed and create the requested narrow local commit. No commit was created while the required clean coverage gate remained red.
