# Task Memory: task_11.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add opt-in, local, content-free clarification lifecycle telemetry and retain generic notification behavior.
- Required facts: capability classification, presentation, settlement, preemption/resumption, and session-loss cancellation.

## Important Decisions

- Start clarification latency when the coordinator first projects the dialog and stop it on the first terminal settlement.
- Use recorder-owned anonymous numeric agent references; request IDs remain transient timer keys and are never serialized.
- Encode form shape with independent single/multi/text booleans plus closed field-count and duration buckets.

## Learnings

- Baseline: the controller already owns clarification projection/settlement, but `TelemetryRecorder` exposes no clarification events or lifecycle methods.
- Existing notifier behavior already uses the shared needs-attention predicate and has focused, unfocused, and needy-to-needy clarification regressions.
- Capability classification can be emitted from `registerRuntime`; its safe diagnostic is the closed classifier reason (or `verified_recipe`) rather than package, version, command, or recipe content.
- The coordinator's terminal callback is the single settlement seam for answers, explicit cancellation, and lifecycle loss. Recorder-owned request watches make duplicate or never-presented settlement a no-op.
- Full-suite telemetry assertions that own a narrower event family must filter that family now that controller startup also emits capability-classification events.

## Files / Surfaces

- Touched: `src/telemetry/recorder.ts`, `src/telemetry/recorder.test.ts`, `src/app/controller.ts`, `src/app/controller.test.ts`, `test/telemetry.integration.test.ts`, `src/notify/notifier.test.ts`, `test/sessionPicker.integration.test.tsx`.

## Errors / Corrections

- The first focused run used a nonexistent repository fixture path in the controller test; switched it to the existing temporary repository fixture.
- The first full coverage run exposed a resume-only telemetry key assertion that iterated all controller startup events; narrowed it to the resume event family without weakening the clarification schemas.

## Ready for Next Run

- Focused lifecycle/privacy/notification tests: 193 passed, 0 failed after the regression correction.
- Full coverage: 1,492 passed, 2 credential-dependent skips, 0 failed; 98.31% lines and 97.29% functions overall. `src/telemetry/recorder.ts` is 100% lines/functions and `src/app/controller.ts` is 98.98% lines.
- Fresh final gate: `rtk bun run typecheck` and `rtk bun test` both passed; 1,492 tests passed, 2 credential-dependent tests skipped, 0 failed.
- Task tracking is complete. Implementation and tests were committed locally as `e9e4cdb` (`feat: add content-free clarification lifecycle telemetry`). Task/memory tracking files and unrelated user changes remain unstaged.
