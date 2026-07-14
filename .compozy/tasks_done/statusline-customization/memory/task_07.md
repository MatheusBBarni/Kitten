# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Render a non-null saved statusline layout through the shared pure renderer while preserving the existing legacy footer exactly for `layout: null`.
- Add direct and mounted-cockpit evidence for ordering, missing values, grapheme ellipsis, constrained widths, resize reactivity, shell hints, and bottom pinning.

## Important Decisions

- Keep the legacy JSX as its own null-layout branch; custom rendering will not reuse or reshape the legacy status chip.
- Use only existing store selectors and controller runtime metadata for the renderer context; no new UI I/O.
- Reserve the unchanged right-side help or shell-exit affordance from the reactive terminal-width budget before calling the pure renderer; hidden overflow remains only the final display-cell guard.

## Learnings

- Pre-change `StatusStrip` always renders the legacy path and does not subscribe to the statusline preference or terminal dimensions.
- The worktree contains unrelated task/config/test edits; this task must stage narrowly.
- OpenTUI's `useTerminalDimensions()` repaints the mounted strip during `TestRendererSetup.resize`, so the production hook and the in-memory integration seam exercise the same resize path.
- Full coverage reports `src/ui/StatusStrip.tsx` at 90% function coverage and 100% line coverage.

## Files / Surfaces

- Touched: `src/ui/StatusStrip.tsx`, `src/ui/StatusStrip.test.tsx`, `src/ui/CockpitApp.test.tsx`, and this task tracking/memory file.

## Errors / Corrections

- The first focused run exposed two test-fixture issues: code-point row length is not a valid display-cell assertion for a family emoji, and the initial branch fixture could not fit beside the real cwd at 80 columns. The grapheme case now asserts one-line/no-sentinel containment, while the width case uses a branch that fits at 80 but is omitted at 64.

## Ready for Next Run

- Implementation, direct UI coverage, cockpit resize coverage, self-review, coverage, typecheck, full tests, self-check, and build are complete.
- Final gate: 1,871 passed, 3 explicitly skipped, 0 failed; `SELF-CHECK OK`; host build and checksum manifest succeeded.
