# Task Memory: task_13.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Opt-in, content-free telemetry: pure re-explanation heuristic in core + local JSONL recorder.
- Events: handoff_invoked/_sent/_repeat, reexplanation_detected, bundle_edit_chars (bucketed), agent_ready/_unready, first_response_ms.
- Off by default; when on, no prompt/code text; local JSONL only, no network.

## Important Decisions
- `src/core/telemetryHeuristics.ts` (pure): `bucketChars` (returns lower bound of coarse bucket, never exact), `editedCharCount` (prefix/suffix-trim changed-region size, catches same-length rewrites), `detectReexplanation(events, threshold)` over `PostHandoffEvent` list.
- Recorder is a factory `createTelemetryRecorder({enabled, sink?, now?, sessionRef?})`; when `enabled=false` returns a NOOP recorder that never constructs a sink (zero fs side effects when off).
- Records carry only enums + numbers (type/at/sessionRef/agent/charBucket/durationMs) — no text field, so content-free is structural. `sessionRef` is an anonymous per-run id, NOT the ACP sessionId.
- first_response_ms + reexplanation derived in `recorder.watch(store)` by diffing per-agent turn counts. Reexplanation watch armed by `handoffSent` AFTER sendPrompt so the bundle's own user turn is consumed first (not mis-flagged).
- editChars for bundle_edit_chars = editedCharCount(bundle.summary, edits.summary), computed in handoff.ts, bucketed by recorder.
- Composition: `createCockpitSession()` in index.ts builds config→store→recorder→controller, records readiness, watch(store); recorder threaded via renderCockpit→CockpitApp→createHandoffFlow. Injectable seams so it is tested without spawning.

## Learnings
- `watch(store)` primes per-agent seenTurns at attach time; pre-existing transcript is not replayed. In tests, apply source work BEFORE watch() or its first response gets counted too (first_response fires for every prompt→response pair, both agents).
- Re-explanation arming order matters: real `actions.sendPrompt` applies the user turn synchronously (before the await), so arming AFTER sendPrompt means the bundle's own turn is already consumed. `fakeController.sendPrompt` does NOT applyEvent, so the integration test built a controller over real `createControllerActions` + a stub connection to keep ordering faithful.
- bun coverage per-file 0.8: kept index.ts healthy by making `createCockpitSession` injectable (loadConfig/buildController/createRecorder seams) and testing it in test/cockpitSession.test.ts.

## Files / Surfaces
- NEW: src/core/telemetryHeuristics.ts (+ .test.ts), src/telemetry/recorder.ts (+ .test.ts), test integration for JSONL.
- EDIT: src/app/handoff.ts (recorder wiring), src/index.ts + src/ui/main.tsx + src/ui/CockpitApp.tsx (thread recorder).

## Errors / Corrections

## Ready for Next Run
