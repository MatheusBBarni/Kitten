# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Deliver the exact `/statusline` cockpit command and keyboard-only disclosure, request, preview/diff, confirmation, failure, and recovery-preset modal workflow with its required UI/integration coverage.

## Important Decisions

- Keep orchestration injected: `CockpitFrame` owns one `StatuslineFlow`, while `StatuslineOverlay` reads narrow selectors and calls only the supplied flow plus `ControllerActions`.
- Use the existing transient store phases as the workflow state; keep only ephemeral row selection and in-flight guards local to the mounted dialog.
- Derive preview context from the captured session runtime and existing branch/model/effort selectors, and render it only through `renderStatusline`/`statuslineText` at the reactive terminal width.

## Learnings

- Tasks 01-05 already provide the pure renderer and exact three presets, store overlay slot, fail-soft acknowledgement/confirmation actions, and strict focused-transcript proposal flow.
- The prompt editor already rejects slash commands with arguments through `cockpitCommandForDraft`; adding the registry entry automatically preserves exact no-argument dispatch.
- Phase-boundary remounting gives each modal phase a deterministic initial keyboard selection without a post-render selection-reset race.

## Files / Surfaces

- Touched task surfaces: `src/ui/keymap.ts`, `src/ui/keymap.test.ts`, `src/ui/PromptEditor.test.tsx`, `src/ui/CockpitApp.tsx`, `src/ui/CockpitApp.test.tsx`, new `src/ui/StatuslineOverlay.tsx`, new `src/ui/StatuslineOverlay.test.tsx`, and `test/fakeController.ts`.

## Errors / Corrections

- The first modal test run hit React's maximum update depth because `selectActiveModal` constructs a fresh object per snapshot. Replaced that subscription with the existing stable approval/clarification boolean selectors used by peer overlays.
- Self-review found the failure view's Cancel action did not visually follow arrow selection. Bound both recovery rows to the local selection and added direct keyboard regression coverage.
- Removed the phase-change selection effect after its post-render timing could overwrite the first recovery key; phase-keyed remounts now reset selection synchronously.

## Ready for Next Run

- Task implementation and self-review are complete.
- Focused statusline gate: 16 passed, 0 failed.
- Full required gate: `bun run typecheck && bun test && bun run selfcheck && bun run build` passed with 1,866 tests, 3 expected opt-in skips, 0 failures, `SELF-CHECK OK`, and a compiled `dist/kitten-darwin-arm64` artifact.
- Fresh full coverage gate passed with 1,866 tests, 3 expected opt-in skips, 0 failures, and `StatuslineOverlay` at 83.87% functions / 92.09% lines.
