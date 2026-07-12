# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Paint a store-free welcome banner during controller handshake, then dispose it before the cockpit root mounts; preserve readiness diagnostics and mark the first successful run.

## Important Decisions

- `main()` will load config once after renderer creation and reuse that snapshot for both the transient banner and the default `createCockpitSession` path, avoiding a second config read.
- Boot-banner lifecycle and first-run reads/writes stay injectable through `MainDeps` so delayed-handshake, blocked-boot, and exact-once marker behavior can be tested without touching user state.

## Learnings

- Pre-change diagnostic on an unresolved controller produced an empty 80x24 frame (`hasConnecting: false`), confirming the blank handshake window.
- `WelcomeBanner.tsx` is present as an untracked task_03 dependency; task_05 must not stage it or other unrelated worktree changes.
- The first focused test exposed that `WelcomeBanner` called store-backed `usePalette()`, so it could not render before `CockpitProvider`; boot must pass a palette resolved from config plus renderer theme while normal cockpit mounts keep live palette resolution.
- A handshake-start signal followed by `renderOnce()` is the deterministic integration-test boundary; it proves the banner frame without a wall-clock delay.
- Coverage run: 777 tests passed, overall line coverage 98.36%, and `src/ui/bootBanner.tsx` reached 100% functions/lines.

## Files / Surfaces

- `src/index.ts`: one-time config load, transient-root lifecycle, first-run seams and successful marker write.
- `src/ui/bootBanner.tsx`: store-free root helper and idempotent disposer.
- `src/ui/bootBanner.test.tsx`: full/quiet/off/disposal coverage.
- `src/ui/WelcomeBanner.tsx`: optional resolved palette for pre-controller rendering; existing live palette path preserved.
- `test/index.integration.test.tsx`: delayed handshake paint-and-swap plus exact-once marker assertion.
- `test/firstRunBoot.test.ts`: blocked readiness path confirms no first-run mark.

## Errors / Corrections

- Initial boot render failed with `useController must be used inside a <CockpitProvider>`. Correct the shared banner boundary instead of adding a fake boot store: accept an optional resolved palette and isolate the live `usePalette()` hook in the cockpit-backed branch.
- Final verification exits 0 but is not warning-free: existing `runSelfCheck` update-outside-`act` and `theme_mode` listener warnings recur. Per `cy-final-verify`, task status/tracking and automatic commit remain blocked; do not broaden task_05 to fix unrelated harness debt.

## Ready for Next Run

- Implementation and task-specific tests are ready. Re-run the full gate after the shared React harness warnings are fixed; only then update task_05 tracking and create the scoped local commit.
