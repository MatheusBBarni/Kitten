# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Render the selector-projected accepted `explore` role and textual restrictions in the sessions overlay, plus a compact selector-projected cue in active child tab labels.
- Preserve focus, selected/overflow reachability, and terminal transcript/lifecycle behavior without presenting live policy on terminal or restored children.

## Important Decisions

- Keep implementation limited to `SessionsOverlay` and `TabWorkspace` presentation consumers; the selector already suppresses policy presentation for terminal children.
- Render the full role and restriction summary as an additional text row in the session card, and append only `compactLabel` to active child tab labels.

## Learnings

- `DelegatedChildPresentation.explore` already contains the active-only role, compact label, and restriction summary; terminal children receive `explore: null` from the selector.
- An accepted child is initially background work; integration coverage must reopen it before asserting the tab cue.

## Files / Surfaces

- Touched: `src/ui/SessionsOverlay.tsx`, `src/ui/SessionsOverlay.test.tsx`, `src/ui/TabWorkspace.tsx`, `src/ui/TabWorkspace.test.tsx`.

## Errors / Corrections

- The red baseline initially asserted a child card below the scrollbox viewport; move the highlight to the child before reading its detail rows.
- `TabSelectionSource` does not include `keyboard`; use the real `kitty_chord` source in focus-routing coverage.

## Ready for Next Run

- Targeted UI suites pass: 46 tests, 0 failures, 170 assertions.
- Coverage gate `bun test --coverage --isolate` exited 0 with the repository's enforced 0.8 threshold.
- Fresh completion gate passed: typecheck plus full tests, `SELF-CHECK OK`, and `bun run build` produced the host artifact and checksum manifest.
- Self-review and `git diff --check` found no blocking issues; unrelated pre-existing workspace changes remain untouched.
