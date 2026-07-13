# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implement boundary-aware prompt recall in the real `PromptEditor`, expose active recall position, document the keyboard behavior, and cover it through mounted OpenTUI textarea tests.

## Important Decisions

- Keep dispatch precedence as slash menu, then unmodified vertical movement, then history navigation only when native movement returns `false`.
- Use the session selector for indicator state and `ControllerActions` for all record/navigation mutations; no UI-local history cache.
- Use `setText` for recall replacement, matching ADR-004's clean-slate editor requirement.
- OpenTUI 0.4.3's shipped renderable implementation always returns `true` from vertical movement despite its boolean declaration, so boundary detection will compare the editor's own visual cursor before/after native movement; no wrap or line geometry is recreated in the UI.

## Learnings

- Installed `@opentui/core` declares boolean `moveCursorUp`/`moveCursorDown` on `EditBufferRenderable`, but the 0.4.3 JavaScript implementation unconditionally returns `true`; full-buffer `setText` remains the correct replacement seam.
- Comparing the native visual cursor offset before and after movement preserves multiline and wrapped editor behavior without duplicating wrap calculations.
- Recalled text needs focus-change synchronization separate from ordinary drafts: clear it when the target session is not recalling, and restore only the target session's selected entry when returning.

## Files / Surfaces

- Touched: `src/ui/PromptEditor.tsx`, `src/ui/PromptEditor.test.tsx`, `src/ui/keymap.ts`, and `src/ui/keymap.test.ts`.
- Tracking-only: this task memory and `task_04.md`.

## Errors / Corrections

- Corrected the TechSpec's assumption that OpenTUI 0.4.3 reports a false movement result at boundaries after verifying the installed declaration and shipped JavaScript implementation.

## Ready for Next Run

- Implementation and self-review are complete.
- Fresh evidence: focused UI/keymap tests 106 pass; full suite 1,342 pass, 1 skip, 0 fail; repository coverage 98.39% lines and 97.21% functions; `SELF-CHECK OK`; Darwin ARM64 build and checksum succeeded.
- The one skipped test is the existing opt-in real-adapter reload probe, not a task failure.
