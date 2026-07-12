# Task Memory: task_14.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Make the shell and curated shell-context hand-off discoverable in the persistent status strip and F1 help, then add a content-free external-run proxy action.

## Important Decisions

- Reserve F3 as a shell-only `run-externally` command. The toggle remains Ctrl+` with F2 fallback.
- The action copies the latest semantic shell command through OpenTUI's OSC 52 clipboard surface, visibly presents the command when copy is unavailable, and records `external_run` only when a command exists.
- Present the external-run result as an overlay inside the shell pane so alternate-screen full-height mode keeps prompt/status chrome hidden and does not lose rows.
- Keep the always-visible discovery hint compact by showing the primary Ctrl+` chord; retain the F2 fallback in the F1 row sourced from `COCKPIT_KEYMAP`.

## Learnings

- OpenTUI exposes `renderer.copyToClipboardOSC52(text)` through `useRenderer`; it returns false when the terminal cannot copy, so the shell must keep a visible command fallback.
- Shared cockpit-frame snapshots in both `CockpitApp` and `ConversationView` include the status strip and must be refreshed when its persistent affordances change.
- At 80 columns, adding F1 text beside the shell and blocked hand-off copy wraps the workspace row. The stable compact form is the primary `^`` shell chord only, with F2 and F1 details left in help.

## Files / Surfaces

- Touched: `src/ui/keymap.ts`, `src/ui/StatusStrip.tsx`, `src/ui/CockpitApp.tsx`.
- Tests/contracts: `src/ui/keymap.test.ts`, `src/ui/StatusStrip.test.tsx`, `src/ui/CockpitApp.test.tsx`, and the CockpitApp/ConversationView frame snapshots.

## Errors / Corrections

- `_tasks.md` still marks task_09/task_11/task_13 pending, but their required source surfaces are present in the dirty worktree. Preserve all existing user changes and keep task_14 edits narrow.
- The first targeted run exposed status-row wrapping and help-copy wrapping. Production was tightened (`wrapMode="none"`, compact status hint, shorter attach text); the rerun passed.
- The first coverage run failed only because ConversationView's shared frame snapshot also contains StatusStrip. Refreshing that intended product-frame contract produced a green coverage run.
- Fresh gates still emit the existing React `act(...)`, OpenTUI `theme_mode` listener-limit, and TreeSitter-destroyed warnings. `cy-final-verify` therefore forbids completion tracking and the automatic commit despite zero test failures.

## Ready for Next Run

- Behavioral checks: task-specific suites 122 pass / 0 fail; full serial coverage 950 pass / 0 fail, 98.58% lines overall and 100% on changed production files; typecheck, self-check, and host build exit 0.
- Keep task status/subtasks pending and do not commit until the repository's warning baseline is clean, then rerun the full gate and tracking sequence.
