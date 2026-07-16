# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Project one render-safe managed-worktree review object into both session-list rows and workspace conversation views without coupling review identity to live delegation.

## Important Decisions

- Cache by the fields the UI can render, not by the raw binding object, so transcript/shell updates and semantically equivalent controller publications preserve review identity.
- Add row-level structural sharing to the session list so one binding update replaces only its owning row; workspace views extend their existing per-conversation cache with the shared review projection.

## Learnings

- Focused selector coverage passes 81 tests and reports `src/store/selectors.ts` at 97.25% lines and 87.72% functions.
- The repository-wide test run repeatedly times out in the unrelated `Markdown > registers capabilities on a direct multi-block mount before code rendering` case; that exact test passes when isolated.

## Files / Surfaces

- Implemented in `src/store/selectors.ts` and `src/store/selectors.test.ts`; `src/ui/TabWorkspace.test.tsx` adds `review: null` to its typed view fixture.

## Errors / Corrections

- Replacing the workspace view's semantic delegation cache key with raw presentation identity broke stability when a background child changed active status. Restored a complete rendered-field delegation key before validation.
- Full completion is blocked by the unrelated Markdown renderer timeout, so task tracking remains pending and no automatic commit was created.

## Ready for Next Run

- Implementation, focused tests, coverage, typecheck, diff check, and self-review are complete.
- Re-run the full gate; update task checkboxes/status and create the narrow commit only after it completes with zero failures.
