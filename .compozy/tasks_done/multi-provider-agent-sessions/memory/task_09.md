# Task Memory: task_09.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
Extend the opt-in, content-free telemetry recorder with 5 new counters: attention latency, idle-fleet time, overview reliance (numerator+denominator), max concurrent sessions. DONE + verified (584 pass, typecheck clean, selfcheck OK).

## Important Decisions
- Split by derivability: store-derivable metrics use `recorder.watch(store)`; action-driven metrics use direct recorder calls (consistent with the existing handoff-event pattern).
  - `attention_latency_ms` (durationMs, agent): watch-derived. Rising edge = status enters a needs-you state; falling edge = status leaves it (the resolution IS the user action). Uniform across awaiting_approval/error/finished.
  - `idle_fleet_ms` (durationMs, agent): watch-derived. Accrues only while `needsAttention && !focused`; emitted on falling edge (session focused or resolved).
  - `focus_switch` (agent) + `overview_switch` (agent): direct calls from `actions.switchFocus`/`jumpToNextNeedy`. Every real focus move → focus_switch (denominator); overview jump-into / jump-next-needy → also overview_switch (numerator). Gated on an ACTUAL focus change.
  - `max_concurrent_sessions` (count): recorded once in `recordReadiness`, = number of READY (live) runtimes.
- Added `count?: number` structural field to `TelemetryRecord` (small int, content-free). Content-free key allow-list now includes it.
- Restart detection for watch timers keys off the session's `acpSessionId` changing (not just turns shrinking) — a status-only needy session with zero turns is not caught by the turns-based check. `AgentWatch.seenAcpSessionId` primed in `watch()`; a change resets all per-session timers silently and skips the commit.
- `FocusTelemetry` narrow port declared in `actions.ts` (only `focusSwitch`), so actions depend on just what they call; full `TelemetryRecorder` satisfies it structurally. Default is a no-op. `switchFocus(sessionId?, options?: { viaOverview?: boolean })` new optional 2nd arg.

## Learnings
- `recordReadiness` is the boot readiness recorder AND now emits max_concurrent after the agent_ready/unready loop; any test asserting the exact readiness event stream had to add `max_concurrent_sessions` (cockpitSession.test.ts, telemetry.integration.test.ts).
- Fake controller (`test/fakeController.ts`) `switchFocus(sessionId?)` records only the first arg; adding the 2nd `options` arg to the real interface doesn't break it (fewer params is assignable) and existing `calls.switchFocus` assertions stay green.
- Default store focuses `order[0]` (claude-code); codex is unfocused by default — handy for idle-fleet tests.

## Files / Surfaces
- `src/telemetry/recorder.ts`: new event types, `count` field, `focusSwitch`/`maxConcurrentSessions` methods (+NOOP), `AgentWatch.{neededSince,idleFleetSince,seenAcpSessionId}`, `processAttention`, watch priming + restart-by-acpSessionId, `recordReadiness` max-concurrent.
- `src/app/actions.ts`: `FocusTelemetry` port, `SwitchFocusOptions`, `recorder` dep, focus/overview recording in switchFocus/jumpToNextNeedy.
- `src/app/controller.ts`: `recorder?` option passed to actions.
- `src/index.ts`: pass `recorder` into `createSessionController`.
- `src/ui/SessionsOverlay.tsx`: jump-into passes `{ viaOverview: true }`.
- Tests: recorder.test.ts, controller.test.ts (createControllerActions block), test/telemetry.integration.test.ts, test/cockpitSession.test.ts.

## Errors / Corrections
- First restart test failed: turns-based restart reset didn't fire for a needy session with 0 turns → spurious attention_latency + idle_fleet on `startSession`. Fixed by adding acpSessionId-change restart detection.

## Ready for Next Run
Task complete and committed. No follow-ups required.
