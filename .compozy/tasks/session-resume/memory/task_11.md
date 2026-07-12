# Task Memory: task_11.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add one concise first-run disclosure that says project sessions are remembered, identifies the XDG-state session storage location, and tells the user how to delete them.
- Render it only when `persistenceEnabled` is true and preserve the existing non-blocking first-run behavior.

## Important Decisions

- Treat the disclosure as formatted guidance only; it must not participate in readiness/blocking decisions.
- Resolve the sessions directory through the existing XDG-aware run-store path helper so the disclosed location matches the active environment.
- Name the picker controls directly: `Ctrl+D` deletes one saved run and `Ctrl+A` deletes all saved runs after opening `Ctrl+R`.

## Learnings

- The focused formatter suite is the meaningful coverage boundary: it reports 91.67% function and 98.55% line coverage. Combining it with the boot integration imports most of the application and fails the aggregate threshold despite the changed module remaining above target.

## Files / Surfaces

- `src/config/firstRun.ts`: guidance options and gated disclosure formatting.
- `src/config/firstRun.test.ts`: enabled, disabled, storage-path, delete-control, and non-blocking assertions.
- `src/index.ts`: XDG sessions-path resolution and one-time successful-boot guidance wiring.
- `test/firstRunBoot.test.ts`: successful boot continues, discloses once, and does not repeat after first-run state is marked.

## Errors / Corrections

- The initial red run produced exactly two expected failures: no formatter disclosure and no successful-boot guidance call. Production changes resolved both without weakening tests.
- Repository-wide `bun test` is not clean: 1062 passed, 2 failed, and 1 skipped. The failures are existing Markdown-rendering tests in `HandoffPreview.test.tsx` and `ConversationView.test.tsx`; the HandoffPreview suite passes alone, while ConversationView still times out alone waiting for a heading color. Both are outside task 11's touched surfaces.
- Repository-wide UI tests continue to emit pre-existing OpenTUI `theme_mode` listener and destroyed-TreeSitter warnings.
- `bun run selfcheck` renders the cockpit but exits 1 because the mandatory reload probe confirms Codex and cannot test Claude while organization policy disables Claude subscription access.
- `bun test --coverage` terminates with Bun signal 5 before producing a repository-wide coverage verdict. The focused formatter coverage command exits 0 above the 80% target.

## Ready for Next Run

- Implementation and task-scoped tests are present, but task status/checklists remain pending and no commit was created because the required full verification gate is not clean.
- Re-run `rtk bun run typecheck && rtk bun test`, `rtk bun test --coverage`, and `rtk bun run selfcheck` after the inherited Markdown/OpenTUI/Bun and Claude-policy blockers are resolved. Only then update task tracking and commit.
