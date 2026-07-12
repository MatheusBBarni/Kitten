# Task Memory: task_12.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Render honest per-pane restoration degradation in `ConversationView`: preserve
  the normal `null` path, label unavailable history, show persisted bundle
  context without fabricating turns, and explicitly seed a fresh agent session
  from the canonical hand-off blocks.

## Important Decisions

- Treat the start-fresh control as the user's explicit send confirmation; it is
  not an automatic resume-time resend and must use `ControllerActions` only.
- Keep the restored bundle in `AppState.restorationBundle` with a narrow selector;
  task 7 accepted the record but otherwise discarded the bundle before the UI
  could render it.
- Reuse the existing `Ctrl+N` chord contextually: it starts only the focused
  unavailable session from the persisted bundle, while normal panes retain the
  existing whole-run reset behavior.

## Learnings

- A rejected `loadSession` can leave the runtime not-ready while restoration is
  `unavailable`; `CockpitApp` must route that state to the degradation view before
  its ordinary startup `NotReadyNotice` branch.
- Character-frame assertions must account for terminal wrapping; restoration
  tests use a short persisted summary and assert visible behavior directly.

## Files / Surfaces

- `src/store/appStore.ts`, `src/store/selectors.ts`: persisted restoration bundle.
- `src/app/actions.ts`, `src/app/controller.ts`: one-session fresh-start action.
- `src/ui/ConversationView.tsx`, `src/ui/CockpitApp.tsx`: degradation rendering and
  contextual `Ctrl+N` dispatch.
- `src/ui/ConversationView.test.tsx`, `src/app/controller.test.ts`,
  `src/store/appStore.test.ts`, `test/sessionRestore.integration.test.ts`, and
  `test/fakeController.ts`: unit and integration coverage.

## Errors / Corrections

- The worktree already contains extensive unrelated and dependency-task edits.
  Isolate task 12 by exact diff review and stage no unrelated paths or hunks.
- The focused suite continues to emit inherited TreeSitter-destroyed fallback
  warnings even when all targeted tests pass; the final warning-free gate remains
  the authority for tracking and commit eligibility.
- Fresh final verification is blocked: both `bun test --coverage` and the full
  `bun test` run terminate with Bun signal 5 after inherited OpenTUI listener,
  `act(...)`, and TreeSitter warnings, before a clean suite/coverage report exists.
- `bun run selfcheck` reaches the cockpit and confirms Codex reload, but exits 1
  because organization policy disables Claude subscription access; this matches
  the shared task-05 probe risk and is not a task-12 implementation failure.

## Ready for Next Run

- Implementation and focused verification are ready: typecheck passes; 151
  store/controller/conversation/restore tests pass; 39 cockpit/boot routing tests
  pass; and the focused ConversationView plus restore integration run passes 34/34.
- Do not mark task complete or commit until a fresh warning-free full test and
  coverage gate completes and the Claude reload probe can authenticate.
