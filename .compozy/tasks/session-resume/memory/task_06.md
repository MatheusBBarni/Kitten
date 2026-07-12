# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the session-picker modal slot and per-session restoration state to the external app store, with narrow selectors and behavior-first coverage for overlay gating and slot isolation.

## Important Decisions

- Use the repository's current `SessionId` identity for the TechSpec's former `AgentId`; `src/core/types.ts` documents that rename and the store is keyed by `SessionId`.
- Extend the existing `appStore`, selector, and `CockpitApp` suites instead of creating parallel test files.

## Learnings

- `selectHasOpenOverlay` is the single gate consumed by `CockpitApp` before shell/global key dispatch, so adding `sessionPicker` there is sufficient for shell stand-down without changing the UI handler.
- A picker-close assertion must use a state with no sibling overlays open; in the slot-isolation case, the overlay gate correctly stays open because approval and handoff preview are preserved.
- Full coverage reaches 98.50% lines overall; `appStore.ts` and `selectors.ts` each reach 100% line coverage for this task.

## Files / Surfaces

- Touched: `src/store/appStore.ts`, `src/store/selectors.ts`, `src/store/appStore.test.ts`, `src/store/selectors.test.ts`, and `src/ui/CockpitApp.test.tsx`.

## Errors / Corrections

- Required skill catalog entries resolve under `.agents/skills`, not `.codex/skills/.system`; corrected before code edits.
- The worktree contains substantial pre-existing changes, including `selectors.ts`, `selectors.test.ts`, and `CockpitApp.test.tsx`; preserve them and isolate task-owned hunks for any commit.
- The first scoped coverage pass exposed an incorrect test expectation: closing only the picker cannot make the aggregate overlay gate false while preserved approval and handoff-preview slots remain open. Split the gate-close scenario from slot isolation; production behavior was correct.
- `git diff --check` over the whole worktree is blocked by pre-existing trailing spaces in UI snapshot rows; task-owned source/test paths add no whitespace errors.
- Fresh full tests pass 1026 with 1 opt-in probe skipped and 0 failures, and full coverage passes at 97.11% functions / 98.50% lines, but both emit inherited OpenTUI `theme_mode` listener and TreeSitter-destroy warnings. The clean final gate therefore remains unavailable.

## Ready for Next Run

- Implementation and scoped acceptance coverage are in place. Re-run `bun run typecheck`, `bun test`, and `bun test --coverage` after the inherited renderer/TreeSitter warning surface is clean; only then update `task_06.md` tracking and create the authorized local commit.
