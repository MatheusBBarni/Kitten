# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Supply the saved custom footer with the current focused session's validated nullable headroom while preserving canonical rendering and the layout-null legacy path.

## Important Decisions

- Keep session ownership reactive through `selectFocusedSessionId`; memoize a per-session `selectSessionHeadroom` selector inside `CustomStatusline`, with a stable null selector when no conversation is focused.
- Pass the raw selector result into `StatuslineContext`; do not format, default, or persist the value in the UI.

## Learnings

- The existing `statuslineFooterBudget` produces a 12-column custom-content budget at terminal width 20 with `/help`, which retains `/work/kitten` and naturally removes trailing `CONTEXT` through `renderStatusline`.
- Focus changes through the fake controller's real store path invalidate both the focused session id and the memoized per-session headroom selector, preventing stale values.

## Files / Surfaces

- `src/ui/StatusStrip.tsx`: focused-session headroom subscription and canonical context input.
- `src/ui/StatusStrip.test.tsx`: valid rendering, focus ownership, omission, narrow-width, and legacy-path regressions.

## Errors / Corrections

- Pre-change signal: `CustomStatusline` had no `contextHeadroom` context member or headroom subscription; the only status-strip headroom selector belonged to `AgentStatusChip`.

## Ready for Next Run

- Focused suite: 22 passed, 0 failed.
- Targeted coverage: `StatusStrip.tsx` 81.25% functions and 97.90% lines.
- Full gate: typecheck passed; 3,036 tests passed, 5 credential-gated tests skipped, 0 failed; `SELF-CHECK OK`; local host build succeeded.
- No shared-memory promotion was needed; the implementation followed ownership and renderer contracts already documented in the PRD and ADRs.
