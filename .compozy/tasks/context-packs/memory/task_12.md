# Task Memory: task_12.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the captured-session Context Pack File Explorer from `task_12.md`: controller-only safe discovery, selector-owned membership, exact whole-file add/remove, explicit blocked states, and stale-response protection.

## Important Decisions

- Keep source identity, digest, and byte materialization in the controller. The React explorer sends only the captured session, path, expected draft revision, and add/remove intent through a closed `ControllerActions` facade.
- Fence membership mutations on the draft revision observed by the explorer. A discovery/materialization race returns a typed stale result and never applies to newer pack state.
- Remove membership by `contextSelectionKey` for the exact `full_file` selection only; same-path slice and diff selections remain untouched.
- Preserve the heavily dirty shared worktree and stage only task 12-owned implementation/test hunks. Per the caller's staging rule, keep task tracking and workflow memory out of the automatic commit.
- Treat `needs_revalidation` as an actionable draft freshness marker; only a true `stale` draft blocks membership edits.
- Give the explorer explicit keyboard ownership after the panel's File Explorer action is activated; Escape returns ownership to panel actions without closing the panel.

## Learnings

- Pre-change signal: `src/ui/ContextPackFileExplorer.tsx` and its test are absent, and `ControllerActions` has repository discovery but no whole-file Context Pack membership facade.
- Existing prerequisites are present: session-keyed `selectContextPack`, store-owned operator mutation, safe repository discovery, bounded materialization, and the captured-session Context Pack panel.
- The controller must rematerialize a full file before adding it so the store receives controller-owned source identity, digest, and byte metadata; removal can synchronously fence the observed revision and delete the exact existing full-file key.
- The keyed explorer body plus effect cleanup prevents a deferred result for session A from replacing session B after a captured-session switch.
- Fresh final evidence: typecheck plus the ordinary repository suite passed with 2,774 pass, 4 skip, and 0 fail; isolated coverage passed on rerun; focused task coverage exceeded 80%; self-check reported `SELF-CHECK OK`; and `build:local` produced `dist/kitten-darwin-arm64`.

## Files / Surfaces

- Touched: `src/app/actions.ts`, `src/app/actions.test.ts`, `src/app/controller.ts`, `src/app/controller.test.ts`, `test/fakeController.ts`, `src/ui/ContextPackFileExplorer.tsx`, `src/ui/ContextPackFileExplorer.test.tsx`, `src/ui/ContextPackPanel.tsx`, and `src/ui/ContextPackPanel.test.tsx`.

## Errors / Corrections

- The first explorer draft blocked `needs_revalidation`, which made a newly created draft non-actionable. Corrected the gate to block only `stale`, then reran targeted and broad verification.
- The first full isolated coverage run had one transient failure despite the ordinary suite being green. A fresh isolated rerun completed successfully; no code change was needed.
- The narrow staged snapshot cannot pass typecheck against `HEAD` because committed `test/fakeController.ts` already defines `recheckCursor`, while committed `ControllerActions` does not. The unrelated unstaged Cursor implementation supplies that contract in the live worktree, so the live full pipeline is green; do not broaden task 12 to commit Cursor recovery work.

## Ready for Next Run

- Task 12 implementation, tests, and tracking are in place. The task-owned patch is staged, but automatic commit is withheld until the independent Cursor contract work lands or the base branch otherwise typechecks without unrelated unstaged edits.
