# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Preserve the root installer and public documentation contracts after the Cockpit workspace migration, then run the full Phase-1 parity evidence matrix.

## Important Decisions

- Do not implement Task 06 against the current checkout: Tasks 01-05 have not produced the required `apps/cockpit` workspace, app-local tests, root delegates, or release bridge.
- Keep Task 06 pending and do not broaden it into the five prerequisite migration tasks in the heavily dirty feature worktree.

## Learnings

- `apps/cockpit` is absent from the working tree and every reachable commit; the public package, runtime, tests, build script, README checker, and manifest remain root-owned.
- Tasks 01-05 are marked `completed` only by uncommitted frontmatter edits. Their checklists remain unchecked, and their task memories independently record the same missing prerequisite implementation.
- The existing root contract tests still live at `test/install.test.ts`, `test/readmeInstall.test.ts`, `test/showcaseReadme.test.ts`, `test/cursorDocumentation.test.ts`, and `test/showcaseSiteWorkflow.test.ts`; Task 06 requires their relocated `apps/cockpit/test/*` forms.
- Strongest available baseline on 2026-07-17: the six root installer, README, showcase, Cursor-documentation, showcase-workflow, and release-workflow suites pass 51 tests with 0 failures.

## Files / Surfaces

- Read-only inspection: `README.md`, `scripts/install.sh`, root and expected Cockpit manifests, root documentation/release tests, release workflow, Tasks 01-06, PRD/TechSpec, and ADRs 001-006.
- Updated only this task memory file; no installer, README, test, workflow, tracking, or implementation surface was edited.

## Errors / Corrections

- Blocking prerequisite mismatch: Task 06 depends on Task 05 and explicitly requires app-local contract tests plus the completed Cockpit artifact layout, but neither exists in this checkout.
- Resume only after Tasks 01-05 are implemented and verified on this branch/worktree, or after switching to the branch/worktree that contains `apps/cockpit/package.json`, relocated runtime/tests/scripts, root delegates, and the app-local release bridge.

## Ready for Next Run

- Reconcile repository state first. Confirm the full `apps/cockpit` boundary and Tasks 01-05 implementation exist before reviewing root installer/README changes or running the Task 06 parity matrix.
