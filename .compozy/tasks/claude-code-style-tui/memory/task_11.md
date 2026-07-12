# Task Memory: task_11.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Rebuild `StatusStrip` as a dual-agent, palette-driven status bar with orthogonal focus/run-state signals, nullable model/context/branch slots, shared cwd, an honest always-visible hand-off hint, and deterministic priority collapse at 80 columns.

## Important Decisions

- Preserve task_08's production contract: `selectSessionModel` and `selectSessionContext` may remain `null`; expose selector-factory injection at the component boundary so rich slot states are exercised without test-only store fields.
- Keep the bar responsive as two fixed rows: agent lozenges on the first row, shared workspace plus hand-off on the second. At 80 columns all rich slots remain visible; below it the declared collapse order is branch, context, then effort.
- Preserve the repository's current multi-session-capable controller surfaces and all unrelated dirty worktree changes; task_11 edits stay scoped to the status bar and its tests unless a verified integration requirement forces a dependent edit.
- Use `waiting` for the `awaiting_approval` run-state and reserve `needs you` for the sessions-overlay attention badge, preventing duplicate badge text while keeping the state explicit.
- Resolve the palette once in `StatusStrip` and pass it to child renderers, reducing the bar from five theme subscriptions to one.

## Learnings

- The current worktree already contains uncommitted task_08/task_09/task_10 dependency changes and unrelated feature work. `StatusStrip.tsx` itself is still on the old chip/keymap-hint implementation and does not consume branch, context, or hand-off state.
- `selectSessionModel` and `selectSessionContext` are intentionally nullable stubs, while a separate existing `selectAgentEffort` selector can populate the optional effort segment.
- The active model-effort feature already populates `selectAgentModel`; production model rendering falls back to that narrow selector after consulting the delegated nullable `selectSessionModel` contract.
- OpenTUI exposes a transient uninitialized frame during resize. Collapse tests must wait for both the removed slot and the expected surviving slots before asserting the settled frame.
- Final evidence: the focused status suite passes 20 tests and reports 88.89% function / 96.99% line coverage for `StatusStrip.tsx`; the repository gate passes 809 tests, typecheck, self-check (`SELF-CHECK OK`), and the native build.

## Files / Surfaces

- Implemented: `src/ui/StatusStrip.tsx`, `src/ui/StatusStrip.test.tsx`, `src/ui/keymap.ts`.
- Integration expectations refreshed: `src/ui/CockpitApp.test.tsx`, `src/ui/__snapshots__/CockpitApp.test.tsx.snap`, `src/ui/__snapshots__/ConversationView.test.tsx.snap`.

## Errors / Corrections

- Corrected an early resize assertion that accepted OpenTUI's transient filler frame; the test now uses a condition-based wait for the surviving context/effort/model content.
- Corrected the production model slot to preserve the already-landed live config-option behavior while keeping task_08's nullable selector contract.
- `cy-final-verify` remains blocked by pre-existing repository-wide harness warnings: React update outside `act`, excess `theme_mode` listeners, and TreeSitter teardown warnings. Per the warning-free commit gate, task checkboxes/status and the automatic commit were not applied.
- A fresh repository-wide `bun test --coverage` run after all task changes crashed Bun 1.3.13 with signal 5 during `HandoffPreview` tests after many passing tests. Focused `StatusStrip` coverage remains clean and above the required threshold, but the runtime crash independently blocks completion and commit.

## Ready for Next Run

- Implementation and requirement evidence are ready. Clear the shared test-harness warning gate and the Bun full-coverage crash, rerun `bun run typecheck && bun test`, `bun run selfcheck`, `bun run build`, and repository-wide coverage, then complete task tracking and the local commit.
