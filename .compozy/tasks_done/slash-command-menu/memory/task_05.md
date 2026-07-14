# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Verify and complete the shared `CockpitFrame.runCockpitCommand` dispatch seam and its `PromptEditor.onRunCommand` plumbing without changing current key ownership.

## Important Decisions

- Preserve the current command model: `switch-focus` and Ctrl+O have been retired in favor of capability-gated `previous-tab` / `next-tab` dispatch, and current tests explicitly reject Ctrl+O. Do not reintroduce the stale task wording without resolving that contract conflict.
- Treat the dispatcher and prop plumbing already present from commit `81d6fbc` as the implementation baseline; add missing behavior-preserving coverage rather than rewriting the same seam.

## Learnings

- `runCockpitCommand` already owns all current cockpit command routes and `PromptEditor` already receives it through `onRunCommand`.
- Current global tab navigation is Ctrl+H/Ctrl+L only after Kitty keyboard confirmation; Ctrl+O and `/switch` are intentionally retired.
- The mounted Ctrl+T regression exposed a dispatcher gap: after shell/help precedence, `onKey` forwarded only `previous-tab` and `next-tab`, so `matchCommand` could return `hand-off` without executing it. Forwarding every non-null command except the already-handled `close-help` restores the shared dispatch path while preserving the overlay guard and Escape ownership.

## Files / Surfaces

- `src/ui/CockpitApp.tsx`
- `src/ui/PromptEditor.tsx`
- `src/ui/CockpitApp.test.tsx`
- `src/ui/keymap.ts`
- `src/ui/keymap.test.ts`

## Errors / Corrections

- The task/TechSpec still require `switch-focus` and a Ctrl+O regression, but the repository's newer command contract excludes both and asserts their absence.
- An initial Ctrl+T test used the prompt-input mock seam, which does not exercise `CockpitFrame`'s renderer-level key listener. The test now emits through `renderer.keyInput`, matching the global chord path.
- The final repository gate is blocked by six pre-existing failures in session status/restoration/clarification and `ConversationView` expectations from the dirty session-tabs/UI worktree. Task-local suites pass, so these failures were recorded rather than expanded into this refactor.

## Ready for Next Run

- Task-local implementation and tests are ready: `CockpitApp.test.tsx` passes 39/39; combined `CockpitApp` and `PromptEditor` suites pass 80/80; `CockpitApp.tsx` coverage is 100% functions and lines, and repository coverage exceeds 97% functions and 98% lines.
- `rtk bun run typecheck` passes and `rtk bun run selfcheck` reports `SELF-CHECK OK`.
- Keep task status pending and do not commit until the repository-wide `rtk bun test` gate is clean; the latest run was 1640 pass, 2 skip, 6 fail.
