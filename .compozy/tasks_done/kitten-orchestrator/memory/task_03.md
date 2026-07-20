# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Relocate the single Cockpit contract suite to `apps/cockpit/test` while preserving app-local CWD and changing only deliberate root-asset reads.

## Important Decisions

## Learnings

- The current worktree has no `apps/cockpit` directory. Cockpit source, tests, launcher, scripts, manifest, and TypeScript configuration are still root-owned even though task tracking marks Tasks 01 and 02 completed.
- The existing `src/` and `test/` trees contain unrelated staged, unstaged, and untracked user changes that must be preserved when the prerequisite whole-app move is available.

## Files / Surfaces

- Read-only inspection: root `package.json`, `tsconfig.json`, `src/`, `test/`, and the kitten-orchestrator PRD/TechSpec/ADRs.

## Errors / Corrections

- Implementation is blocked on the missing Task 01/02 workspace boundary. Moving only `test/` would break the required app-local imports/CWD and silently expand Task 03 into prerequisite runtime/package relocation.

## Ready for Next Run

- Resume after Tasks 01 and 02 are present in this worktree, or after switching to the worktree/branch containing `apps/cockpit/package.json`, `apps/cockpit/src`, `apps/cockpit/bin`, `apps/cockpit/scripts`, and `apps/cockpit/tsconfig.json`.
