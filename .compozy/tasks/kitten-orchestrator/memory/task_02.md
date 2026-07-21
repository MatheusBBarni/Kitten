# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Relocate the Cockpit runtime, launchers, build program, and TypeScript project into `apps/cockpit` without changing observable behavior.

## Important Decisions

- Paused before code edits because Task 01's required workspace/package boundary is absent. Task 02 must not silently implement the predecessor task.
- Preserve the dirty root `src/` tree intact; it contains unrelated user-owned staged, unstaged, and untracked work that the later atomic move must carry without loss.

## Learnings

- `.compozy/tasks/kitten-orchestrator/task_01.md` says `status: completed`, but all Task 01 subtasks remain unchecked.
- The root `package.json` is still the public `@matheusbbarni/kitten` manifest, while `apps/cockpit/package.json` and `apps/cockpit/tsconfig.json` do not exist.

## Files / Surfaces

- Read-only inspection: root `package.json`, `tsconfig.json`, `src/`, `bin/`, `scripts/build.ts`, Task 01 tracking, and the Task 02 PRD/TechSpec/ADRs.
- Updated only this task memory file; no runtime, launcher, build, configuration, or tracking implementation files were edited.

## Errors / Corrections

- Blocking prerequisite mismatch: Task 01 tracking claims completion without its required implementation. Restore/complete Task 01 and verify its manifest/configuration contracts before resuming Task 02.

## Ready for Next Run

- Resume by confirming the root is a private `apps/*` workspace and that `apps/cockpit/package.json` plus `apps/cockpit/tsconfig.json` exist with the public Cockpit contract. Then move the dirty runtime tree atomically and preserve all user-owned changes.
