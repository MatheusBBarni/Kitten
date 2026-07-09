# Task Memory: task_11.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Approval prompt overlay: render `overlays.approval`, show the pending action (agent, kind, title, diff) and its options, answer through `actions.respondPermission`. Done and verified.

## Important Decisions

- The overlay does NOT call `closeApproval()`. Answering settles the request and the controller then opens the next queued one or clears the slot; closing here too would clobber a second request opened in the same tick.
- Modality is declared in two halves, not left to framework ordering: `preventDefault()` in the dialog stops the focused textarea, and `CockpitFrame` returns early on `selectIsApprovalOpen` so its own chords stand down. See Learnings for why `stopPropagation()` alone does not work.
- Approval keys are deliberately kept OUT of `HELP_ENTRIES`. The overlay is modal, so F1 cannot open the help panel while they are live, and they do nothing while it is closed. The overlay prints `APPROVAL_HINT` instead.
- `EditDiff` in `ToolCallRow.tsx` was exported as `ToolCallDiffView({diff})` and reused rather than duplicated.
- The diff is the only shrinkable child of the dialog (`flexShrink: 1` + dialog `maxHeight`). A truncated diff still names the file; options pushed off-screen would strand a blocked agent.
- Selection reset on a queued request uses render-phase state adjustment (`if (shown !== overlay) {...}`), not `useEffect` or a `key` hack.

## Learnings

- `useKeyboard` global listeners fire in **mount order, not tree order**. `CockpitFrame` mounts before `ApprovalDialog` (which only mounts when the slot fills), so the dialog's `stopPropagation()` can never outrank the shell. Child-effects-first only holds for components mounted in the same commit.
- `preventDefault()` blocks renderable handlers (the focused textarea, `onKeyDown` props); `stopPropagation()` additionally blocks *later* global listeners. Neither blocks *earlier* global listeners. The renderer's Ctrl+C listener is registered in its constructor and outranks everything.
- `mockInput`: `pressArrow("up"|"down")`, `pressEnter()`, `pressEscape()`, `pressKey(name, mods)`, `typeText()`. Digits arrive as `key.name === "1"`.
- Root `overflow:"hidden"` + a viewport-bounded `captureCharFrame()` mean an oversized absolute overlay never *paints* out of bounds. So an overflow-artifact assertion cannot detect an unbounded overlay; assert that the options and hint are still visible instead.

## Errors / Corrections

- **Vacuous assertion, caught by mutation testing.** `expect(calls.switchFocus).toEqual([])` also accepts `[undefined]` (Jest/Bun `toEqual` ignores undefined array items) - which is exactly the call the focus chord makes. The modality test passed while the shell guard was missing. Use `toHaveLength(0)`.
- **Vacuous assertion #2.** `waitForFrame(p)` returns the current frame when `p` already holds, so a keystroke asserted right after `actAsync` has not painted yet. To prove a key did not leak into the composer, close the overlay first and read the frame after.
- **Vacuous test #3.** The first "clips a long diff" test passed with `maxHeight` deleted. Rewrote it to assert the options/hint survive; it now fails under both `maxHeight` removal and `flexShrink: 0`.
- Typecheck caught `Parameters<typeof startMockAgent>[1]["onPrompt"]` indexing an optional parameter. Used the exported `MockPromptScript` instead. Runtime tests were green while types were broken - `bun test` alone is not a gate.

## Files / Surfaces

- new: `src/ui/ApprovalPrompt.tsx`, `src/ui/ApprovalPrompt.test.tsx`
- `src/ui/keymap.ts`: `KeyBinding<Command>` made generic; added `ApprovalCommand`, `APPROVAL_KEYMAP`, `APPROVAL_HINT`, `matchApprovalCommand`, `approvalOptionIndex`
- `src/ui/CockpitApp.tsx`: mounts `<ApprovalPrompt/>` last; `onKey` returns early while approval is open
- `src/ui/ToolCallRow.tsx`: exported `ToolCallDiffView`
- `src/store/selectors.ts`: added `selectIsApprovalOpen`
- `test/fakeController.ts`: `respondPermission` now closes the approval slot, mirroring the real controller

## Ready for Next Run

Verified: `bun run typecheck` exit 0, `bun test` 316/316, `bun test --coverage` exit 0 (touched files at 100%).
task_12's hand-off preview mounts alongside this overlay; it is NOT modal (`selectIsApprovalOpen` deliberately excludes it), so it must decide its own key precedence.
