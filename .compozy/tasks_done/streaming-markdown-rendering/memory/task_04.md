# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Render the hand-off summary through the shared Markdown leaf in read mode while keeping the edit textarea and send path on one React-state draft.
- Preserve redaction visibility, modal key routing, approval precedence, and all non-summary curation behavior.

## Important Decisions

- Extend the existing `src/ui/HandoffPreview.test.tsx` real OpenTUI/controller harness; no new test file or mocked renderer boundary.
- Treat the current integrated-shell and target-config edits in `HandoffPreview` as user-owned overlap and modify only the summary-specific hunks.
- Use the textarea content-change callback to copy its live buffer into `summaryDraft`; read mode and `flow.confirm` consume only that state.

## Learnings

- The current preview always mounts a textarea and sends `summary.current?.plainText ?? bundle.summary`, so it has neither a rendered read state nor React state as the send authority.
- OpenTUI 0.4.3 exposes textarea changes through `onContentChange`; the event is empty, so the callback must read `TextareaRenderable.plainText`.
- The shared Markdown leaf styles heading text with the theme accent but OpenTUI retains heading marker glyphs in the captured character frame; `captureSpans` is the reliable read-mode discriminator from the muted textarea.

## Files / Surfaces

- `src/ui/HandoffPreview.tsx`
- `src/ui/HandoffPreview.test.tsx`
- `.compozy/tasks/streaming-markdown-rendering/task_04.md` (tracking only, after verification)

## Errors / Corrections

- The worktree already contains extensive unrelated changes, including shell-context additions in both preview files. Preserve and exclude them from the task commit.
- OpenTUI's textarea has no working Ctrl+A select-all binding in this harness; tests use a real inserted prefix and assert the exact resulting prompt block instead of changing key bindings outside scope.
- Focused and full UI test runs still emit inherited `theme_mode` listener and destroyed tree-sitter warnings. The clean verification contract therefore blocks status completion and auto-commit even though assertions pass.
- The final fresh `bun run typecheck && bun test` rerun terminated with Bun signal 5 / exit 133 (`Segmentation fault at address 0x5`) after those warnings, matching the shared workflow risk. This supersedes the earlier non-crashing full-suite run as completion evidence.

## Ready for Next Run

- Implementation and self-review are complete in `HandoffPreview.tsx` and its canonical test suite: local `summaryDraft` owns read/edit/send, read mode uses `Markdown`, and edit mode syncs `TextareaRenderable.plainText` through `onContentChange`.
- Fresh evidence: focused suite 29 pass / 0 fail; focused coverage reports `HandoffPreview.tsx` at 100% functions and 97.74% lines; standalone typecheck passes; one full suite run reported 972 pass / 0 fail but warned; self-check prints `SELF-CHECK OK`; diff check is clean. The final required full-gate rerun crashed with exit 133 before completion.
- Do not mark task 04 completed or commit until a fresh full run is free of the inherited warnings recorded above. The task file remains `pending` and its checkboxes remain unchecked.
