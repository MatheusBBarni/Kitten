# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add a strict durable editor preference to the existing user-config loader and atomic writer, with loader/writer/integration coverage.

## Important Decisions

- Keep Task 4 on the existing config persistence path; editor patches replace one whole validated preference while the writer freshly re-reads and preserves every unrelated delta.
- Define the resolved preference in the protocol-free config/domain contract so config loading does not depend on the untracked Task 3 launcher implementation.

## Learnings

- The repository-wide coverage run exceeded the 120-second compiled-artifact timeout under instrumentation, while that test passed alone in 2.6 seconds and the ordinary full suite passed; task surfaces still measured 100% line coverage for the loader and 92.47% for the writer.
- Adding `editor` to required resolved `AppConfig` required updating typed fixtures across app, config, UI, and integration tests; those files contain unrelated in-progress changes and must be staged hunk-by-hunk.

## Files / Surfaces

- Contract and persistence: `src/core/types.ts`, `src/config/configLoader.ts`, `src/config/configWriter.ts`.
- Direct coverage: `src/config/configLoader.test.ts`, `src/config/configWriter.test.ts`.
- Typed fixture compatibility: `src/app/controller.test.ts`, `src/config/readiness.test.ts`, `src/ui/ApprovalPrompt.test.tsx`, `src/ui/HandoffPreview.test.tsx`, `src/ui/ModelSelect.test.tsx`, `test/askUserMcp.integration.test.ts`, `test/orchestration.integration.test.ts`, `test/sessionStatus.integration.test.tsx`, `test/shellRuntime.integration.test.ts`, `test/telemetry.integration.test.ts`.

## Errors / Corrections

- The first focused run exposed that the editor schema was inserted before the existing statusline schema chain finished; moved it below the statusline transform before continuing validation.
- The next focused run had one assertion comparing raw delta shapes to normalized `AppConfig`; narrowed it to persisted-byte equality plus normalized resolved-field checks.
- A warning-free full-gate rerun hit the known shared-state Markdown capability flake once; `src/ui/Markdown.test.tsx` then passed 40/40 in isolation and the next complete typecheck/test gate passed 2,614/2,614 runnable tests without warnings.

## Ready for Next Run

- Implementation, self-review, targeted suites, full typecheck/test gate, and self-check are complete. Tracking is ready and the code/test hunks can be committed narrowly without including task-memory or unrelated worktree state.
