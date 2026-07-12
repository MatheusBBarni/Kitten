# Task Memory: task_10.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add confirmed per-run and delete-all actions to the saved-run picker, refresh its project list after mutation, and prove the filesystem and agent-store boundaries in tests.

## Important Decisions

- Use `Ctrl+D` for the highlighted run and `Ctrl+A` for all Kitten runs so deletion remains reachable without stealing printable filter text.
- The first chord arms an inline confirmation and the same chord confirms; `Esc` cancels an armed deletion before it can close the picker.
- Deletion calls only the injected `RunStore`; no controller or agent-session deletion surface is introduced.

## Learnings

- Targeted coverage reports `SessionPicker.tsx` at 95.65% functions / 94.64% lines and `keymap.ts` at 93.75% / 98.82%; Bun still exits 1 because the command instruments the imported application graph, whose aggregate is 42.85% / 48.41%.
- Full `bun test --coverage` passes with 1,060 tests, 1 opt-in probe skipped, 0 failures, and 96.88% function / 98.32% line coverage; `SessionPicker.tsx` is 95.65% / 94.74% in that run.
- The focused post-change gate passes: typecheck, 96 picker/keymap/integration tests, and direct headless `--self-check` (`SELF-CHECK OK`).

## Files / Surfaces

- Touched: `src/ui/SessionPicker.tsx`, `src/ui/SessionPicker.test.tsx`, `src/ui/keymap.ts`, `src/ui/keymap.test.ts`, and `test/sessionPicker.integration.test.tsx`.

## Errors / Corrections

- A test initially batched both confirmation chords into one React update, so both handlers saw the unarmed state. The test now waits for the confirmation frame before sending the second chord, matching real interaction timing.
- The focused coverage tests themselves passed (14/14), but the targeted coverage command returned 1 on the repository-wide aggregate threshold; touched picker/keymap surfaces are above 80%.
- The repository completion gate is not clean: full tests pass but emit inherited TreeSitter and `theme_mode` listener warnings, while `bun run selfcheck` invokes the real reload probe and exits 1 because organization policy disables Claude Code subscription access. Codex reload passes. Per the workflow gate, task status remains pending and no commit is created.

## Ready for Next Run

- Baseline picker/keymap/integration tests pass (91 tests); task-10 delete commands and `runStore.delete` calls are absent before implementation.
- Implementation and required tests are present. Re-run the full warning-free gate after the inherited OpenTUI warnings are resolved and Claude access is enabled (or an Anthropic API key is configured); only then update task checkboxes/status and commit.
