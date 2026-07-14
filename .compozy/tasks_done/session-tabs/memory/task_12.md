# Task Memory: task_12.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Make Session Tabs boot-safe for valid empty and restore-unavailable workspaces while preserving the repository gate, fresh-run readiness failure, cleanup, self-check, and per-provider isolation.
- Add only the TechSpec-approved opt-in tab telemetry and validate the complete lifecycle/restore path with privacy-focused tests.

## Important Decisions

- Keep the existing readiness report for fresh startup failures, but treat an empty workspace and a workspace containing only `restore-unavailable` / `provider-unavailable` conversations as valid mountable states.
- Tab telemetry will carry no conversation/session identity. Selection, lifecycle, restore, attention, and latency records use closed enums and coarse buckets only.
- Measure tab-switch latency from the accepted selection action until the focused conversation commits in React; write only the source and coarse duration bucket.
- Existing user modification to `README.md` is out of scope and must remain unstaged by the automatic task commit.
- Preserve concurrent user UI work that appeared during this run. Do not stage or rewrite its activity-strip, status-strip, composer, model, slash-menu, or keymap changes.

## Learnings

- Pre-change signal: `rg` found none of the eight approved `tab_*` event names under `src` or `test` (exit 1).
- `main()` currently derives its readiness block solely from `controller.runtimes()`, so both an empty restored workspace and a single restore-unavailable conversation are falsely blocked.
- The task-specific typecheck and focused boot, readiness, controller, telemetry, privacy, cockpit, restore, self-check, and build checks pass.
- Coverage exceeded the task target on touched production surfaces: `src/telemetry/recorder.ts` 100% functions/lines, `src/config/readiness.ts` 94.12%/99.01%, and `src/index.ts` 85.96%/91.64%.
- The repository-wide gate is not clean: 1,637 tests pass, 2 skip, and 6 fail against concurrently changed UI contracts. The failures expect the removed tab/status strip and former `/new` restore behavior in `test/sessionStatus.integration.test.tsx`, `test/sessionRestore.integration.test.ts`, `test/clarificationLifecycle.integration.test.tsx`, and `src/ui/ConversationView.test.tsx` (three cases).

## Files / Surfaces

- Touched implementation: `src/index.ts`, `src/app/actions.ts`, `src/app/controller.ts`, `src/telemetry/recorder.ts`, `src/ui/CockpitApp.tsx`, `src/ui/SessionsOverlay.tsx`, and `src/ui/TabWorkspace.tsx`.
- Touched verification: `src/app/controller.test.ts`, `src/config/readiness.test.ts`, `src/telemetry/recorder.test.ts`, `test/firstRunBoot.test.ts`, `test/index.integration.test.tsx`, `test/telemetry.integration.test.ts`, and new `test/sessionTabs.integration.test.tsx`.

## Errors / Corrections

- The pre-existing boot integration still waited for the obsolete literal `resumed` and expected `/new` to restart the old fixed fleet. Updated it to the current `history restored` label and Session Tabs contract: `/new` creates one independent conversation from the selected provider.
- Initial latency instrumentation settled inside the synchronous action call. Corrected it to start after an accepted selection and settle from the mounted cockpit effect after the focused session commits.
- `cy-final-verify` cannot pass while the six concurrent UI regressions remain. Leave task status/checklists unchanged and do not create the automatic commit until a fresh full suite is clean.

## Ready for Next Run

- Re-run `rtk bun run typecheck && rtk bun test` after the concurrent UI work reconciles its stale integration expectations and the Session Tabs mounting contract.
- Then re-run `rtk bun run selfcheck`, `rtk bun run test:coverage`, and `rtk bun run build`; only after all are clean, update task tracking and create the narrow task commit.
