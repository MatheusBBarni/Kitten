# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implement the task-03-only external editor launcher boundary with direct argv dispatch, strict placeholder validation, one custom-to-default fallback, fixed outcomes, and focused coverage.

## Important Decisions

- Keep controller/action production wiring out of this task because task 05 explicitly owns that integration; expose a factory and injected spawn/platform seams here.
- Add a distinct `unsupported-platform` outcome because task 03 explicitly requires unsupported platforms to remain distinguishable from final dispatch failure.
- Treat a malformed custom preference as `failed` without spawning either custom or fallback commands; fallback is reserved for a valid custom dispatch failure.

## Learnings

- The TechSpec names only macOS `open` and Linux `xdg-open` as supported system-default launchers.
- The `rtk test ! -e ...` baseline command is rewritten incorrectly on this workstation; use explicit file listing/status checks instead.
- A narrow Bun coverage run reports 90.91% functions and 100% lines for the launcher.
- The repository-wide gate currently has one unrelated intermittent failure in `src/ui/Markdown.test.tsx` at the direct multi-block capability-registration test; the same test passes in isolation, while both final full-suite attempts failed at its 20-frame wait.

## Files / Surfaces

- `src/app/externalEditor.ts`: public launcher/preference/openable-file contracts, injected direct process seam, supported-platform argv construction, validation, and fallback.
- `src/app/externalEditor.test.ts`: exact argv, malformed preference, fallback cardinality, process failure, and unsupported-platform unit coverage.
- `test/externalEditor.integration.test.ts`: prevalidated-path pass-through with no repository discovery command.

## Errors / Corrections

- Initial shell-builtin baseline check failed inside RTK (`sh: -e: command not found`); this was a command-wrapper issue, not a repository signal.
- Final verification is not clean: `rtk bun run typecheck && rtk bun test` passes typecheck and 2,600 tests but fails the Markdown frame-timing test above (4 credential-gated skips). Per the task workflow, completion tracking and the automatic commit were withheld.

## Ready for Next Run

- Task 03 implementation is present and focused verification is clean, but task tracking remains pending until the repository-wide gate passes. No automatic commit has been created.
- Once the inherited Markdown gate is green or explicitly accepted as non-blocking, rerun final verification, self-review the three launcher files, mark task tracking complete, and create the narrow local commit.
- Task 05 can inject `externalEditorLauncher` or `createExternalEditorLauncher(...)` and map its closed outcomes to session-scoped notices.
- `OpenableFile` is the explicit app-layer handoff token; the workspace source must produce its canonical regular-file `absolutePath` only after use-time revalidation.
