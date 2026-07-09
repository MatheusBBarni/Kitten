# Task Memory: task_10.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Prompt editor + send flow. Done and verified: `bun run typecheck` clean, `bun test` 285/285, `bun test --coverage` exit 0 (PromptEditor/keymap/CockpitApp all 100%).

## Important Decisions

- The editor is fixed chrome, so `CockpitFrame` renders `<PromptEditor/>` directly (like `StatusStrip`) rather than taking a second slot prop. Only the variable conversation region stays a `children` slot.
- No `usePaste`. A focused `TextareaRenderable` already handles bracketed paste itself (`handlePaste` -> `insertText` after `stripAnsiSequences`). Adding the hook would insert the paste twice. ADR-004's "use `usePaste`" is guidance, not a constraint; the built-in path is strictly better.
- Escape precedence solved with the framework's own ordering rather than shared state: the shell's `useKeyboard` handler calls `key.preventDefault()` only when help is open, which suppresses every renderable handler, so the editor's `onKeyDown` never fires. Closing help can therefore never also interrupt a working agent.
- Editor height tracks `lineCount` (logical lines) with a floor of 3 rows, not `virtualLineCount`. See Learnings.
- Submission gate is `controller.isReady(focusedAgentId)` only. The draft survives a blocked submit, so switching to a ready agent keeps the user's words.
- `PROMPT_KEY_BINDINGS` is typed mutable (`TextareaKeyBinding[]`), not `readonly`, because that is what OpenTUI's `keyBindings` prop accepts; it must stay a module-level constant or the textarea rebuilds its lookup map every render.

## Learnings

- `TextareaRenderable.virtualLineCount` is stale inside `onContentChange`: it reflects the last laid-out view, so it still reads 1 while the buffer holds 2 logical lines and the frame paints 2 wrapped rows. Unusable for sizing the viewport it derives from. `lineCount` is immediate.
- OpenTUI's textarea defaults are Enter=newline, Meta+Enter=submit. `mergeKeyBindings` overrides by exact `name:ctrl:shift:meta:super` signature, so a custom entry replaces a default cleanly.
- Only the Kitty keyboard protocol distinguishes Shift+Enter from Enter, so the editor tests pass `kittyKeyboard: true` to `testRender`. It also encodes Escape as a full sequence, sidestepping the 20ms lone-ESC disambiguation wait.
- `mockInput.pasteBracketedText(text)` emits the paste in three stdin chunks; the parser accumulates until the end marker with no size cap while a paste is open, so a 78KB paste arrives as one `PasteEvent`. Pasted newlines never reach the keypress path, which is why paste cannot trigger submit.
- A keystroke reaches the edit buffer immediately but only paints on the next pass. `captureCharFrame()` right after `typeText` shows the pre-keystroke frame; always `waitForFrame`.

## Files / Surfaces

- `src/ui/PromptEditor.tsx` + `src/ui/PromptEditor.test.tsx` (new)
- `src/ui/keymap.ts` - `HelpEntry`, `PROMPT_KEY_BINDINGS`, `EDITOR_KEYMAP`, `HELP_ENTRIES`
- `src/ui/CockpitApp.tsx` - mounts the editor; Escape now consumed only while help is open; `HelpOverlay` renders `HELP_ENTRIES`
- Snapshots regenerated: `CockpitApp.test.tsx.snap`, `ConversationView.test.tsx.snap`

## Errors / Corrections

- `rtk tsc` reported "No errors found" on a file that `tsc --noEmit` rejected (`readonly KeyBinding[]` -> `KeyBinding[]`). There is no `tsc` on PATH, so the wrapper filtered empty output into a false pass. Always gate on `bun run typecheck`.
- The editor's placeholder contains "Shift+Enter", and `ConversationView.test.tsx` waited on `frame.includes("hi")` - which "Shift" satisfies. The snapshot was captured before the turn painted. Predicate tightened to the role label.

## Ready for Next Run

- task_11's approval overlay must claim Escape ahead of the editor. Use the same lever: `preventDefault()` in a global `useKeyboard` handler while the overlay is open.
- Follow-up (not in scope): submission is not gated while the focused agent is `working`, so a second Enter mid-turn reaches `sendPrompt` and the agent will likely reject it.
- Follow-up (not in scope): a single long wrapped line does not grow the editor, because only logical lines are counted.
