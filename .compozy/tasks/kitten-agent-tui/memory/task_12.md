# Task Memory: task_12.md

Keep only task-local execution context here. Do not duplicate facts obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Complete + verified. One-keystroke (`Ctrl+T`) hand-off/hand-back: assemble → redact → editable preview → confirm → send + focus switch. Symmetric via focus-derived direction.

## Important Decisions
- Direction is derived (target = the non-focused agent via `nextAgentId`), not configured - that is what makes hand-off and hand-back one flow.
- The bundle is immutable; developer edits (`HandoffEdits`: summary + `excludedFiles`/`excludedDiffs` by identity) are layered at compose time. Files/diffs dropped by identity, not index.
- Empty compose → `[]` → nothing sent, preview stays up (a bare instruction telling the target to continue an unexplained task is worse than not sending).
- Preview draws only the highlighted diff (`flexShrink:1`) so the hint + Enter never scroll off a 24-row terminal.

## Learnings
- OpenTUI's single-focused-renderable rule forced the `PromptEditor` change: composer blurs (`focused={!overlayOpen}`) so the preview's summary textarea can hold the cursor, and refocuses on close. This is what the "returns keyboard to composer" test guards.
- `Ctrl+T` chosen over `Ctrl+H` (ASCII backspace collision on non-Kitty terminals).

## Files / Surfaces
- New: `src/app/handoff.ts`, `src/ui/HandoffPreview.tsx`, `src/app/handoff.test.ts`, `src/ui/HandoffPreview.test.tsx`.
- Modified: `src/ui/CockpitApp.tsx` (mounts preview, binds `Ctrl+T`, one `useMemo` flow), `src/ui/PromptEditor.tsx` (blur while overlay open), `src/ui/keymap.ts` + `keymap.test.ts` (`HANDOFF_KEYMAP`, `matchHandoffCommand`, `HANDOFF_HINT`, `HANDOFF_EDIT_HINT`).

## Errors / Corrections
- None. Implementation was already present in the working tree on this run; verified end-to-end rather than re-authored.

## Ready for Next Run
- task_13 telemetry hooks into `src/app/handoff.ts` for hand-off events. Both files at 100% coverage; full suite 373/373.
