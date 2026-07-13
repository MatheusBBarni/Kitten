# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add honest per-runtime status-strip headroom (percent plus fixed-width neutral bar, or `—`) with memoized per-session subscriptions and 80-column frame coverage.

## Important Decisions

- The live session-tabs strip no longer has the task packet's older `AgentStatusChip`; preserve the newer null-selection workspace summary and model/effort selector seam while reintroducing a compact per-runtime chip abstraction for the required side-by-side signal.
- Unknown headroom renders only `—`; known headroom uses the existing text color for fill and `muted` for track, with no threshold verdict or palette change.
- The strip bar is three cells wide so two populated default chips and the fallback discovery hint fit exactly in the 80-column frame; detailed model/effort remains selected-chip-only to preserve the newer session-tabs contract.

## Learnings

- A focused-only strip was the concrete pre-change signal; the new frame tests failed with no headroom and no Codex chip before implementation.
- Scoped coverage imports broad controller/store dependencies and fails the repository-global threshold even while `StatusStrip.tsx` itself exceeds 80%; the full coverage gate is the authoritative result.

## Files / Surfaces

- `src/ui/StatusStrip.tsx`
- `src/ui/StatusStrip.test.tsx`
- `src/ui/CockpitApp.test.tsx` (inspect/update only if the mounted-frame contract changes)
- `test/sessionStatus.integration.test.tsx`

## Errors / Corrections

- Initial side-by-side rendering exposed both agents' model/effort strings and clipped the focused long model at 80 columns. Corrected by retaining detailed configuration only on the focused chip while keeping status and headroom on both.
- The first scoped coverage command exited 1 because repository-wide coverage was 61.81% with only one test file loaded; full coverage passed at 97.04% functions / 98.26% lines, with `StatusStrip.tsx` at 100% / 100%.

## Ready for Next Run

- Implementation and self-review complete. Fresh gates: `bun run typecheck && bun test` passed (1,277 pass, 1 skip, 0 fail); `bun test --coverage` passed (97.04% functions, 98.26% lines); `bun run selfcheck` printed `SELF-CHECK OK`.
