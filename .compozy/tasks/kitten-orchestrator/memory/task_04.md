# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Delegate root development and CI commands to the relocated Cockpit package while preserving README validation order, root installation policy, isolated coverage, and independent site installation.

## Important Decisions

- Do not implement task 04 against the current checkout: its required `apps/cockpit` package, runtime, scripts, and tests from tasks 01-03 are absent. Absorbing those prerequisite tasks would violate the approved task graph and task 04 scope.

## Learnings

- Tasks 01-03 are marked `completed` only by uncommitted status-line edits in their task files. Their required implementation is absent from the working tree, `HEAD`, local branches, and listed worktrees.
- The current root manifest remains the public `@matheusbbarni/kitten` package and invokes `src/index.ts` directly; `.github/workflows/ci.yml` still invokes the root README checker and root-owned scripts.

## Files / Surfaces

- Inspected: `package.json`, `.github/workflows/ci.yml`, `scripts/check-readme-install.ts`, `bunfig.toml`, `site/package.json`, task 01-04 files, PRD/TechSpec, and ADRs 001-006.
- Expected but missing: `apps/cockpit/package.json`, `apps/cockpit/tsconfig.json`, `apps/cockpit/scripts/`, and `apps/cockpit/test/`.

## Errors / Corrections

- Prerequisite tracking contradicts repository state: task files 01-03 say `completed`, but only their frontmatter status changed; their subtasks remain unchecked and no implementation exists.

## Ready for Next Run

- Resume only after tasks 01-03 are actually present in this checkout (or after switching to the branch/worktree containing them). Then rerun the preflight and implement the six-item execution checklist captured in this run.
