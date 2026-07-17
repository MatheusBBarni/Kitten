# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add exact clarification-handle cancellation, typed controller start outcomes, and closed bridge-failure telemetry without changing route-wide invalidation.

## Important Decisions

- Keep task 01 scoped to controller and recorder contracts; multi-socket bridge lifecycle remains task 02.
- Map bridge capacity-limit reasons to `capacity_limited`, invalid client frames/duplicates to `invalid_request`, and registration, authorization, I/O, and request failures to `unavailable`.
- Project start admission with `KittenMcpBridgeError("busy" | "unavailable")` so the bridge never classifies arbitrary controller error text.
- Reuse the coordinator's exact-entry settlement path for handle cancellation so active and suspended requests share one idempotent terminalization rule while route-wide generation invalidation remains separate.

## Learnings

- Pre-change clarification handles expose only `timeout()`, bridge construction omits `onFailure`, and controller start-guard/route failures throw generic text errors.
- The recorder's existing façade/no-op split is the privacy boundary: accepting only a closed category union there keeps serialized bridge records structurally content-free.
- Controller bridge-failure mapping covers all current closed bridge reasons; no raw reason or runtime identity crosses into telemetry records.

## Files / Surfaces

- `src/app/controller.ts`: exact clarification cancellation, typed start outcomes, bridge failure mapping/callback.
- `src/app/controller.test.ts`: cancellation isolation/idempotence, replacement invalidation, typed outcomes, controller-to-recorder integration.
- `src/telemetry/recorder.ts`: closed bridge failure event/category and disabled no-op.
- `src/telemetry/recorder.test.ts`: exact schema, disabled behavior, closed category validation, privacy-negative coverage.
- `src/app/kittenMcpBridge.test.ts`: test handle updated for the expanded controller contract.

## Errors / Corrections

- The initial compile-negative telemetry test widened its invalid literal to `string`; changed it to pass the literal directly so `@ts-expect-error` proves the closed API.
- The bridge callback integration initially counted unrelated startup telemetry; changed it to filter the bridge event type before asserting the exact mapped records.
- One filtered coverage extraction run returned a non-zero pipeline result after a prior clean full coverage run; retain the clean run as the coverage gate and treat filtered reruns only as aggregate-percentage extraction.

## Ready for Next Run

- Task 02 can call `ClarificationRequestHandle.cancel("connection_error")` for one lost child socket and classify controller start rejection from `KittenMcpBridgeError.reason` without message matching.
- Closed bridge failure telemetry is available through `onFailure` -> controller mapping -> `mcpBridgeFailure(category)` and must remain content-free.
