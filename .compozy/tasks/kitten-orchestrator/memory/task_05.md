# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Bridge the root release workflow and Release Please metadata to Cockpit-owned artifacts without changing public release assets, npm identities, tags, installer URLs, provenance, or Bun-free smoke behavior.

## Important Decisions

- Keep Task 05 pending and do not modify release code until Tasks 01-04 have produced the required `apps/cockpit` workspace boundary.
- Do not expand Task 05 into the prerequisite workspace, runtime, test, and CI relocation tasks in the dirty feature worktree.

## Learnings

- The current branch still has the public package, `src/`, `test/`, `bin/`, and build script at the repository root; `apps/cockpit` does not exist.
- Task 01-04 tracking files say `completed`, but their checklists remain unchecked and no reachable branch, checked-out worktree, or unreachable commit contains the Cockpit relocation.
- Existing release contracts still import root `package.json`, `scripts/build.ts`, and root test paths, so there is no coherent app-local producer/consumer layout for Task 05 to bridge.

## Files / Surfaces

- Inspected `.github/workflows/release.yml`, `release-please-config.json`, `.release-please-manifest.json`, root `package.json`, and the five root release/package integration tests.
- Updated only this task memory file; no implementation or tracking files were changed by this run.

## Errors / Corrections

- Blocking prerequisite mismatch: the task specification requires `apps/cockpit/package.json`, `apps/cockpit/scripts/build.ts`, and `apps/cockpit/test/*`, but the directory is absent.
- Resume only after the Task 01-04 implementation is present on this branch/worktree or after the user points this run at the branch/worktree containing it.

## Ready for Next Run

- Re-run repository reconciliation first and confirm `apps/cockpit` exists with the public manifest, build script, relocated tests, and root workspace/CI delegates before editing Task 05 release surfaces.
