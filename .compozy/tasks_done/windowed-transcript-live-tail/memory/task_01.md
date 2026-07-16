# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Build the pure transcript projection and colocated contract coverage without changing reducer or UI behavior.

## Important Decisions

- Model projection as one input object containing immutable authoritative turns, the enabled flag, revealed depth, and explicit protection data.
- Treat revealed history as turns immediately preceding the recent-tail boundary; the earliest protected historical turn moves the retained boundary backward so the output remains one contiguous suffix with at most one marker.
- Use absolute source indices for turn keys and the exact hidden absolute range for the marker key.

## Learnings

- The projection can derive pending/in-progress protection directly from authoritative tool status while also honoring explicit active tool identities from the caller.
- The projection and existing reducer ordering/upsert suites pass together (52 tests), and isolated projection coverage reports 100% functions and lines.

## Files / Surfaces

- Implemented `src/core/transcriptProjection.ts` and `src/core/transcriptProjection.test.ts`; updated this task memory only. Reducer, UI, ACP, config, persistence, and shared workflow memory remain unchanged.

## Errors / Corrections

- The worktree contains unrelated user changes across app, UI, telemetry, tests, and other task packets; preserve them and stage only task-owned files.
- Full `bun run typecheck && bun test` is blocked by three repeatable delegated-lifecycle failures in `test/orchestration.integration.test.ts` and `test/telemetry.integration.test.ts`. Those paths depend on pre-existing dirty controller/telemetry work and are outside this task; do not mark complete or commit until the repository-wide gate is clean.
- Self-review strengthened protection tests so active stream, explicit active tool, pending status, in-progress status, and approval ownership each independently prove the retained boundary.

## Ready for Next Run

- Implementation and task-scoped evidence are ready. Re-run the full repository gate after the unrelated delegated-lifecycle work is repaired; only then update `task_01.md` tracking and create the scoped local commit.
