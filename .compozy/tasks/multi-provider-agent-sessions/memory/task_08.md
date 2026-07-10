# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Add `src/notify` module: bell + per-OS native notification (osascript/notify-send/PowerShell), focus-gated, content-free, per-session dedup. Wire at boot in `src/index.ts` next to telemetry recorder.

## Important Decisions
- **Focus gate semantics (reconciles task Requirements vs Tests).** On a non-needy->needy transition: FOCUSED => in-app only, fire NEITHER bell nor channel (per unit test "focused fires neither"). UNFOCUSED or UNKNOWN => ring bell AND call channel (unknown is the fallback path). Bell rings before channel; channel wrapped in try/catch so a failed shell-out still leaves the bell rung. "Always ring the bell" is read as "always ring within the notify path", not "in every focus state".
- **Dedup = per-session boolean needy latch.** Fire only on false->true (was-not-needy -> needy). Transitions among needy states (awaiting_approval->error) do NOT re-fire. Latch primed from initial store state so pre-existing needy sessions never fire a spurious notification.
- **Seams:** `NotificationChannel` (channel), `FocusSource.current(): "focused"|"unfocused"|"unknown"` (focus), `ringBell: () => void` (default `process.stdout.write("\x07")`). `buildNotificationCommand(platform, input)` is pure + unit-testable; `createOsNotificationChannel` runs it via injectable runner (default `spawn`, best-effort). No shell string interpolation of untrusted text; AppleScript strings escaped.

## Learnings
- OpenTUI `CliRenderer` (EventEmitter) emits `CliRenderEvents.FOCUS`="focus" / `BLUR`="blur" (DECSET 1004). `createRendererFocusSource(renderer)` latches state; starts "unknown".
- `selectSessionList` (src/store/selectors.ts) already yields per-session `{id,title,providerKind,cwd,status,needsAttention}` in order - exactly the notifier's needs. Subscribe via `store.subscribeSelector(selectSessionList, ...)`.
- main() tests use fake controller w/ static store (no post-mount transitions) so default notifier wiring never spawns; still added `wireNotifier` seam to MainDeps.

## Files / Surfaces
- new: src/notify/channel.ts, src/notify/focus.ts, src/notify/notifier.ts (+ tests)
- modified: src/index.ts (boot wiring + `wireNotifier` seam)

## Errors / Corrections
- None. Default channel line 107-114 (real Bun.spawn `spawnCommand`) intentionally not unit-covered (injected runner used); per-file coverage still >=80% lines (channel 85, notifier 97, focus 100).

## Ready for Next Run
- DONE + committed. task_09 (attention/multi-session telemetry) is next; it reuses the same `selectSessionList` transition stream the notifier watches. Notifier wiring lives in `main()` via `wireAttentionNotifier(renderer, store)` + `MainDeps.wireNotifier` seam (NOT in `createCockpitSession`, which lacks the renderer). If task_09 needs attention-latency timing, it can hook the same non-needy->needy edge the notifier detects.
