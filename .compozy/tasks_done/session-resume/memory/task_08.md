# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- At boot, resume the current project's newest persisted run by `updatedAt`; otherwise preserve the existing fresh cockpit.
- Make the resumed state visible and provide a keyboard-discoverable way to start fresh sessions.

## Important Decisions

- Infer the visible resumed state from the existing per-session `restoration` map; a fresh run clears those values back to `null`.
- Use a controller action for starting fresh so the React UI never reaches agent connections directly.
- Select the maximum `updatedAt` in the boot seam even though the file store already sorts summaries, keeping injected stores honest in tests.

## Learnings

- The worktree contains broad pre-existing task changes, including untracked persistence files; task 08 edits and any staging must remain isolated.
- `createCockpitSession` already owns the run store and writer, but it currently never queries persisted runs before starting the writer.
- Starting the run writer after restore prevents its fresh snapshot from racing the boot-time newest-run lookup.
- The existing `restoration` map is sufficient for a global resumed marker without adding duplicate boot state.

## Files / Surfaces

- Touched: `src/index.ts`, `src/app/actions.ts`, `src/app/controller.ts`, `src/ui/CockpitApp.tsx`, `src/ui/StatusStrip.tsx`, `src/ui/keymap.ts`.
- Tests: `test/cockpitSession.test.ts`, `test/index.integration.test.tsx`, `src/app/controller.test.ts`, `src/ui/StatusStrip.test.tsx`, `src/ui/keymap.test.ts`, plus the shared fake controller.

## Errors / Corrections

- The rendered integration passes but emits the inherited OpenTUI `TreeSitter client destroyed` teardown warning already tracked in shared memory; final verification must treat warnings as a commit/tracking gate.
- Typecheck initially rejected a nullable callback recorder in the boot unit test; changed the test recorder to an array without changing behavior.
- Coverage passed at 96.79% functions / 98.33% lines with 1,039 passing, 1 skipped, and 0 failing tests, but emitted inherited TreeSitter and `theme_mode` warnings.
- Final `bun run typecheck && bun test && bun run selfcheck` reached 1,039 passing tests, then failed the real reload probe: Codex confirmed; Claude was blocked because organization policy disabled Claude subscription access. No tracking update or commit is allowed under the clean-verification contract.
- The non-probe `bun run src/index.ts --self-check` passed with `SELF-CHECK OK`, isolating the remaining failure to the external reload gate.

## Ready for Next Run

- Implementation and task-specific tests are in place; rerun the full gate after Claude access is enabled and the inherited warning surface is clean.
- If the gate is clean, re-review the task 08 diff, update this memory first, then task checkboxes/status, and create the single local commit without pushing.
