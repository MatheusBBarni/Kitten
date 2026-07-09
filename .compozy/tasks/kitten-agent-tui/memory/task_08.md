# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
Done. Cockpit shell (renderer bootstrap, focused-pane frame, status strip, global keymap, help overlay, theme + resize handling) with `testRender` coverage.

## Important Decisions
- Moved the UI out of `src/app` into `src/ui`: `src/app/bootstrap.tsx` -> `src/ui/main.tsx`, placeholder `src/app/CockpitApp.tsx` deleted. `src/index.ts` keeps the `import.meta.main` entry contract and re-exports `renderCockpit`.
- `main()` now returns `BootedCockpit {renderer, controller, closed}` instead of the bare renderer, and gained an injectable `createController`. Destroy -> `controller.dispose()` -> `onExit()`, awaited via `closed`, so Ctrl+C cannot orphan the spawned ACP adapters.
- Added two files beyond the task's list because the requirements needed them: `src/ui/theme.ts` (dark/light palette) and `src/ui/cockpitContext.tsx` (the `useSyncExternalStore` binding + controller context). The help overlay lives inside `CockpitApp.tsx`.
- Keys: `Ctrl+O` switch focus, `F1` toggle help, `Esc` close help. All chords/function keys so the task_10 prompt editor keeps every printable key. `matchCommand` reports `close-help` for Esc unconditionally; the shell only acts when help is open, leaving Esc free for the editor/overlays.
- Status precedence: a not-ready runtime beats the store status (a not-ready agent has no session). Not-ready focused agent replaces the transcript with its `AgentRuntimeState.error` (PRD: "say exactly what is missing").
- Frame is sized from `useTerminalDimensions()` (absolute width/height), not percentages, so one resize pass re-lays the whole tree.

## Learnings
- `KeyEvent` names as delivered by the test mock: F1 -> `"f1"`, Ctrl+O -> `{name:"o", ctrl:true}`, Esc -> `"escape"`.
- A lone `ESC` is buffered by OpenTUI's stdin parser for `DEFAULT_TIMEOUT_MS = 20ms` (escape-prefix disambiguation). `waitForFrame` spins faster than that, so an Escape test must sleep >20ms in real time (`ESCAPE_DISAMBIGUATION_MS` in `test/reactTui.ts`). Two `pressKey` calls with no delay merge into one parsed sequence.
- `captureCharFrame()` ends with a trailing newline: strip it before counting rows.
- Right after `resize()`, a frame can be the right size but still hold the buffer's uninitialized filler (`U+0A00`). Gate `waitForFrame` on real content, and assert `not.toContain("਀")` to catch stale cells.
- Yoga `gap` applies between *every* pair of row children, including a `flexGrow` spacer - it silently ate the strip's right margin. Group the chips in an inner gapped box and leave the outer row gapless.
- Bun's per-file `coverageThreshold` also gates non-test helpers under `test/` (`coverageSkipTestFiles` only skips `*.test.*`), so `test/fakeController.ts` needed `test/fakeController.test.ts`.

## Files / Surfaces
- New: `src/ui/{main.tsx,CockpitApp.tsx,StatusStrip.tsx,cockpitContext.tsx,keymap.ts,theme.ts}` + tests, `src/ui/__snapshots__/CockpitApp.test.tsx.snap`.
- New test helpers: `test/fakeController.ts` (`createFakeController`, `readyRuntimes`), `test/reactTui.ts` (`actAsync`, `destroyMounted`, `sleep`, `ESCAPE_DISAMBIGUATION_MS`).
- Changed: `src/index.ts`, `test/index.integration.test.tsx`. Deleted: `src/app/bootstrap.tsx`, `src/app/CockpitApp.tsx`.

## Errors / Corrections
- Self-review caught: a `createController()` throw (invalid config) left the renderer holding raw mode. `main()` now destroys the renderer before rethrowing; covered by a test.

## Ready for Next Run
- Follow-up (out of scope): `src/ui/.gitkeep` is now redundant; `bun build --compile` still fails at baseline (task_12/14).
- The conversation region renders `props.children` (empty-state hint when absent), so task_09 mounts `ConversationView` as `<CockpitApp>`'s child. Task_10's editor needs a sibling slot under the region - CockpitApp must grow a second slot then.
