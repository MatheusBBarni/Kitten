# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Build the ShellPane bridge from the controller-owned runtime into OpenTUI with revision-isolated rendering, faithful supported terminal styles, bounded scrollback, and live resize propagation.

## Important Decisions

- Subscribe to `shell.renderRev` rather than the whole shell slice so cwd/command and agent events cannot wake the pane.
- Expose the controller's `ShellRuntimeState` through a dedicated cockpit-context hook; emulator state remains outside the store.
- Return the active bounded xterm buffer from `ShellRuntime.view()` so the pane's scrollbox has real scrollback rather than only viewport rows.

## Learnings

- OpenTUI 0.4.3 inline spans accept indexed/RGB foreground and background through `RGBA`, plus all standard `TextAttributes`; the core has no overline attribute.
- The task 05 implementation is present and its task file says completed, but `_tasks.md` still lists it pending because tracking has not been reconciled.

## Files / Surfaces

- Touched: `src/ui/ShellPane.tsx`, `src/ui/ShellPane.test.tsx`, `src/ui/cockpitContext.tsx`, `src/shell/shellRuntime.ts`, `src/shell/shellRuntime.test.ts`, and `test/shellPane.integration.test.tsx`.

## Errors / Corrections

- OpenTUI `captureSpans()` resolves ANSI palette intent into framebuffer RGB values, so tests assert the rendered channels rather than the pre-render intent metadata.
- OpenTUI's focused scrollbox did not consume the synthetic Home key through the test renderer; scrollback navigation is verified through the scrollbox's public `scrollTo` surface.
- Fresh full verification exits green but emits the repository-baseline React `act(...)` and OpenTUI `theme_mode` listener warnings. Per `cy-final-verify`, task status and checkboxes remain pending and no automatic commit was created.

## Ready for Next Run

- Implementation and required unit/integration coverage are present. Targeted suite: 19 pass, 0 fail. Full coverage: 913 pass, 0 fail, 98.56% lines overall, `ShellPane.tsx` 100%.
- Re-run the warning-clean full gate after the shared test-warning baseline is repaired; only then update `task_08.md` tracking and create the task commit.
