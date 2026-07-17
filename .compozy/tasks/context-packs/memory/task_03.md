# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implement strict V4 run persistence for session-keyed Context Pack draft manifests and exact sealed payloads, with safe V1-V3 compatibility and no restored live authority.

## Important Decisions

- Keep this task scoped to persistence boundaries and the narrow controller/store restoration handoff; preserve unrelated dirty controller and workspace changes.
- Treat per-session Context Pack projections independently during load so one malformed sibling can be dropped without discarding the valid run or other sessions.
- Represent restored sealed custody as an explicit durable-only sealed variant; it retains exact payload fields but cannot be refined as a live sealed value because review manifest, accounting, and source fences are intentionally absent.
- Validate restored draft manifests at the serialization boundary with the existing domain restoration contract, and cap content-free invalid-projection diagnostics at eight per record.

## Learnings

- Pre-change persistence accepts only RunRecord V1-V3, and RunWriter emits V3 with no Context Pack projection.
- V1 restore already depends on resolved session descriptors; the controller safely lifts V1 through the existing V1 migration before migrating V2/V3 state into the V4 envelope.
- JSON serialization preserves the exact sealed string value, including CRLF and composed/decomposed Unicode; the schema separately verifies its UTF-8 byte count and never invokes the redactor for sealed payloads.
- Full repository coverage after implementation is 98.18% lines, with 2,666 passing tests and zero failures.

## Files / Surfaces

- Persistence: `src/persistence/runRecord.ts`, `runStore.ts`, `runWriter.ts` and their colocated tests, including new `runRecord.test.ts`.
- Restoration/state: narrow Context Pack changes in `src/app/controller.ts`, `src/app/controller.test.ts`, `src/core/contextPack.ts`, `src/core/types.ts`, `src/store/appStore.ts`, and `src/store/selectors.ts`.
- V4 writer integration expectations: `test/sessionTabs.integration.test.tsx`, `test/sessionRestore.integration.test.ts`, and `test/steeringObservability.integration.test.ts`.

## Errors / Corrections

- The worktree contains extensive unrelated edits, including existing `controller.ts` changes; avoid broad rewrites and stage only Task 03 surfaces.
- The first full coverage run found three stale V3 writer expectations. Updating those integration contracts to V4 resolved the only failures; the steering telemetry symptom was caused by its fake store rejecting V4 before recording.

## Ready for Next Run

- Implementation, self-review, tracking, and verification are complete. Fresh final gate: `rtk bun run typecheck && rtk bun test` passed with 2,666 tests, zero failures, and four credential-gated skips. Coverage gate passed at 98.18% lines. Task 03 code/test hunks are ready for the narrow local commit; tracking and memory remain outside it.
