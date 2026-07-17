# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implement the separate app-layer workspace explorer source and its adversarial tests: lazy shallow listing, fixed fail-soft results, contained-link handling, and use-time open revalidation.

## Important Decisions

- Keep the source independent from `fileDiscovery.ts`; use that file only as a shape and safety reference.
- Keep task scope to `workspaceExplorer.ts` and its colocated tests; controller/store/UI consumption belongs to later tasks.

## Learnings

## Files / Surfaces

- Planned: `src/app/workspaceExplorer.ts`
- Planned: `src/app/workspaceExplorer.test.ts`

## Errors / Corrections

- Blocked before implementation by a contract conflict: `task_02.md` says symlinks MUST never be exposed, while `_techspec.md` requires eligible contained symlinks to be emitted as `contained_link`, and ADR-001/ADR-003 require contained-link traversal/opening. The execution workflow forbids choosing a side without clarification.

## Ready for Next Run

- Resolve the symlink policy explicitly. If contained links are intended, correct the task requirement to exclude only broken, escaping, looping, or unsupported links; otherwise revise the TechSpec and ADRs to prohibit all symlinks.
