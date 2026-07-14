# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Render ready Cursor status and model-selection UI through the total provider metadata map, preserving narrow selectors, visible-session tabs, keyboard behavior, and session-scoped actions.

## Important Decisions

- Use `PROVIDER_METADATA[kind].compactLabel` in both views; do not add a Cursor branch or widen UI subscriptions.
- Exercise Cursor config writes with opaque option IDs and values so the test proves routing by `SessionId`, not provider-specific semantics.

## Learnings

- The default store already seeds Cursor, while the common UI fake exposes only two ready runtimes; Cursor-ready fixtures must provide the third runtime explicitly.
- Shared compact labels are title-cased (`Claude`, `Codex`, `Cursor`), so direct footer contract tests must assert the metadata casing.
- Full coverage after the final source changes: 1,710 pass, 2 opt-in skips, 0 fail; 97.29% functions and 98.16% lines. Changed views are 100%/99.65% line-covered (`StatusStrip`/`ModelSelect`).

## Files / Surfaces

- Main scope: `src/ui/StatusStrip.tsx`, `src/ui/StatusStrip.test.tsx`, `src/ui/ModelSelect.tsx`, and `src/ui/ModelSelect.test.tsx`.
- Direct contract updates: `src/ui/CockpitApp.test.tsx` and `test/sessionStatus.integration.test.tsx` now expect metadata capitalization.

## Errors / Corrections

- Pre-change production signal: both views still use a binary `claude-code`/else provider label and therefore render Cursor as Codex.
- First focused test run found a missing `readyRuntimes` test import; production rendering was unaffected, and the fixture import was corrected before rerunning.
- The first tab-order assertion matched `Cursor` in the dialog title; it was narrowed to the actual tab row before rerunning.
- Full coverage exposed stale lowercase compact-label expectations in `CockpitApp` and session-status integration tests; only those direct expectations were updated.

## Ready for Next Run

- Implementation and self-review are complete. Fresh gates passed: `bun run typecheck && bun test` (1,710 pass, 2 opt-in skips, 0 fail), `bun run test:coverage` (97.29% functions, 98.16% lines), `bun run selfcheck` (`SELF-CHECK OK`), and `bun run build` (host binary plus checksum).
- No task_06 follow-up remains; unavailable/recovery presentation stays outside this task as specified.
