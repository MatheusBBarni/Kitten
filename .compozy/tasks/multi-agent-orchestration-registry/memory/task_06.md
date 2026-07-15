# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Surface delegated child lineage/lifecycle and parent active/settled state in existing tabs and `/sessions`, preserving normal transcript navigation, attention semantics, narrow-width reachability, and cached selector ownership.

## Important Decisions

- Extend render-ready store projections with a stable delegation presentation union; React views consume selector-provided lifecycle text and do not inspect raw delegation records.
- Keep generic `SessionStatus` presentation intact in `/sessions`; delegated `Needs input` is an additional lifecycle line and the unread `needs you` badge remains separate.
- Key the session-list projection by immutable workspace, delegation, and session slices. Key visible/background list stability by workspace order so active background-child lifecycle churn does not notify an unchanged parent tab.
- Terminal result inspection remains the existing child transcript: `/sessions` adds an `Open transcript` cue but selection still calls the normal reopen path and leaves delegation ownership unchanged.

## Learnings

- Pre-change selectors expose raw narrow delegation records plus generic workspace/session rows, but neither render-ready row includes lineage, delegated lifecycle labels, terminal transcript availability, or parent group presentation.
- The worktree contains substantial uncommitted prior-task implementation. Treat it as the dependency baseline and stage only task 06 surfaces plus required tracking/memory files.
- A self-review caught that the first session-list cache draft omitted the session slice, which could preserve stale generic status. The cache now includes session identity and a regression test proves status changes rebuild the list.
- Scoped coverage reports `selectors.ts` 92.00% functions / 97.67% lines, `SessionsOverlay.tsx` 91.67% / 98.79%, and `TabWorkspace.tsx` 92.31% / 97.69%. The coverage command still exits 1 because importing the cockpit expands instrumentation to unrelated files below the repository threshold.

## Files / Surfaces

- Touched: `src/store/selectors.ts`, `src/store/selectors.test.ts`, `src/ui/TabWorkspace.tsx`, `src/ui/TabWorkspace.test.tsx`, `src/ui/SessionsOverlay.tsx`, `src/ui/SessionsOverlay.test.tsx`.

## Errors / Corrections

- Fresh scoped gate passes: `rtk bun run typecheck && rtk bun test src/store/selectors.test.ts src/ui/TabWorkspace.test.tsx src/ui/SessionsOverlay.test.tsx` -> 108 pass, 0 fail. `rtk bun run selfcheck` and `rtk bun run build` also pass.
- Repository gate remains non-clean: `rtk bun test` -> 1995 pass, 4 skip, 211 fail. A fresh isolated `rtk bun test test/releaseWorkflow.test.ts` reproduces the first blocker as 11 pass / 2 fail because the workflow still contains `NODE_AUTH_TOKEN` and `secrets.NPM_TOKEN`; the full run then emits `TreeSitter client destroyed` and blank-canvas UI cascades.
- Do not update task/master completion tracking or create the automatic commit while this required full-suite gate is failing.

## Ready for Next Run

- Implementation and scoped verification are ready. Completion tracking and the automatic commit remain pending the unrelated repository-wide gate becoming clean.
