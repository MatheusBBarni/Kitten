# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Generalize the controller to one runtime per resolved session, each `newSession` against its own cwd, keyed by `SessionId`.
- Much was already landed by task_01/02: `Map<SessionId, AgentRuntime>`, `newSession(seed.cwd)`, per-session degrade, focus-first-ready. Remaining gaps below.

## Important Decisions
- **3.4 approval labeling:** `ApprovalOverlay` gains required `title` + `cwd` (UI display is task_07). Controller reads them from `runtimes.get(sessionId).seed`.
- **3.5 opening prompt:** after actions are built + focus set, fire-and-forget `actions.sendPrompt(seed.task, seed.id)` for each ready session carrying a `task`. Uses sendPrompt so the user turn is recorded in the transcript; errors flow through onError.
- **3.3 per-session repo readiness:** add `cwd` to `AgentRuntimeState`; fold a per-session repo check in `firstRun.ts` (`sessionSetup`) so a connected session whose own cwd is not a git repo is reported not-ready with a directory-specific reason, without blocking siblings. Keep `buildFirstRunReport` blocking = `!insideRepo || !anyReady`; a non-repo session just becomes not-ready, so the fleet is blocked only when no session is usable. Post-spawn gate keeps `insideRepo: true` (fold repo into per-session readiness instead).
- **Store-seeding divergence fix (shared handoff):** `createCockpitSession` no longer pre-creates a default store; it lets the controller seed from `resolveSessions(config)` and calls `recorder.watch(controller.store)`. Removes the non-default-config desync.

## Learnings
- `readiness.ts` / `readinessSetup` / `checkAllAgentsReadiness` are a pre-boot per-provider probe path NOT wired into `main()`; the live boot readiness aggregation is `runtimeSetup` + `buildFirstRunReport` in `index.ts`. Left readiness.ts untouched.
- `createSessionController` calls `resolveSessions` with `existsSync`, so declared-session controller tests must point at real existing dirs (use repo subdirs).

## Files / Surfaces
- src/store/appStore.ts (ApprovalOverlay), src/app/controller.ts, src/config/firstRun.ts, src/index.ts.
- Test call sites of `openApproval` updated to carry title+cwd; `AgentRuntimeState` fixtures gain cwd.

## Errors / Corrections
- Per-session repo check broke `test/index.integration.test.tsx`: its fake `readyRuntimes()` cwd was the fictional `/workspace/kitten`, so `main()`'s readiness gate marked them not-ready and the default `onBlocked=exitBlocked` called `process.exit(1)`, killing the whole `bun test` run. Fix: `readyRuntimes()` now uses `process.cwd()` (a real repo).

## Ready for Next Run
- task_03 complete and verified: typecheck 0, `bun test` 485 pass / 0 fail, build 0. Coverage: controller 99.3%, firstRun 98.4%, index 86.7%, appStore 100%.
- Follow-up (recorded in shared Open Risks): pre-spawn repo gate in `main()` still keys off launch cwd only.
