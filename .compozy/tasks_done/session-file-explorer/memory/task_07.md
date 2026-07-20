# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the single explorer command path, focus-scoped keyboard tree, presentational selector/action view, and docked/narrow cockpit composition with mounted coverage.

## Important Decisions

- Do not invent UI-local explorer mutations or I/O to work around missing controller actions; task 07 must consume the session-addressed `ControllerActions` seam owned by task 05.
- Do not absorb task 02 or task 05 into this frontend task. Their containment and orchestration contracts must be reconciled first.

## Learnings

- The committed store/selectors expose explorer visibility, focus, and per-session position, but `ControllerActions` currently exposes no explorer toggle/list/expand/refresh/open operations.
- `src/app/workspaceExplorer.ts` and its tests are absent. Task 02 memory records an unresolved contract conflict: its task requirement prohibits all symlinks, while the TechSpec and ADRs require eligible `contained_link` entries.
- Task 05 memory already stopped before edits because the missing task 02 source prevents production explorer capability injection.

## Files / Surfaces

- Inspected: `src/ui/CockpitApp.tsx`, `src/ui/keymap.ts`, `src/ui/PromptEditor.tsx`, `src/ui/cockpitContext.tsx`, `src/store/appStore.ts`, `src/store/selectors.ts`, `src/app/actions.ts`, `src/app/controller.ts`, and `test/fakeController.ts`.
- No production or test source files were changed.

## Errors / Corrections

- Blocked before implementation: task 07 depends on task 05, task 05 depends on task 02, and the required explorer source/action seam is absent because task 02 has a source-of-truth symlink-policy conflict. Proceeding would require guessing that policy or silently broadening this task into backend containment/orchestration work.
- The task files for tasks 02, 03, and 05 are locally marked `completed` despite open checkboxes and memory that records blocked or unverified work; status is not accepted as implementation evidence.

## Ready for Next Run

- Resolve task 02's symlink policy explicitly, implement and verify its workspace source, then complete task 05's explorer actions/controller injection. Resume task 07 after `ControllerActions` exposes the required explorer operations.
