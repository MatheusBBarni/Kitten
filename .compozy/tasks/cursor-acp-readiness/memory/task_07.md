# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add a protocol-free, closed Cursor recovery projection to unavailable workspace availability, map normalized initial and restore failures through one controller boundary, expose it through a safe selector, and preserve structural sharing without adding UI, actions, adapter, telemetry, or persistence scope.

## Important Decisions

- Recovery is derived only from normalized readiness cause enums; `AgentRuntimeState.error` and all raw probe/ACP detail remain outside the projection.
- Keep generic `ConversationAvailability` behavior unchanged for non-Cursor sessions and model recheck eligibility separately from the existing runtime `retryable` flag.
- Preserve the existing uncommitted Cursor recheck/controller work from earlier tasks and extend its shared failure path narrowly.

## Learnings

- Pre-change state has no Cursor recovery field or selector, and workspace availability equality currently compares only `reasonCode` plus `retryable`, so recovery-only changes would be suppressed.
- A single exhaustive cause table can cover all preflight and normalized connection outcomes while keeping `AgentRuntimeState.error` out of workspace state; initial and restored failures can share the same frozen projection value.
- Selector subscription equality follows the workspace reducer's structural sharing, so comparing the three closed recovery fields is sufficient to publish recovery-only changes and suppress equal-object updates.

## Files / Surfaces

- Touched: `src/core/types.ts`, `src/core/workspace.ts`, `src/core/workspace.test.ts`, `src/store/selectors.ts`, `src/store/selectors.test.ts`, `src/app/controller.ts`, and `src/app/controller.test.ts`.
- Deliberately unchanged: `src/persistence/**`, `src/telemetry/**`, `src/ui/**`, `src/app/actions.ts`, and adapter/config surfaces.

## Errors / Corrections

- The worktree is intentionally dirty with earlier task changes, including overlapping edits in `src/app/controller.ts` and `src/app/controller.test.ts`; preserve them and stage this task narrowly.
- The first focused run had one failure because an inherited exact availability assertion expected the pre-task three-field Cursor object. Updated that regression to include the new safe version-mismatch projection; no production logic correction was needed.
- Final repository verification is blocked by the unrelated non-isolated Markdown direct-mount frame-predicate timeout. Two consecutive broad reruns ended at 2,575 pass / 4 skip / 1 fail, while `src/ui/Markdown.test.tsx` immediately passed 40/40 alone. Automatic commit and completion tracking remain withheld.

## Ready for Next Run

- Focused suites pass: 333 tests across workspace, selectors, and controller; the selector-only post-adjustment run passes 92 tests.
- Typecheck passes, and the isolated repository coverage run passes 2,576 tests with 4 skipped and 0 failed across 138 files.
- Self-review found no raw-detail path into availability or selector output and no task-scope references under persistence, telemetry, or UI.
- Resume by rerunning the canonical full suite; if it is clean, reapply task tracking, narrow-stage the seven task files, review the cached diff, and create the authorized local commit.
