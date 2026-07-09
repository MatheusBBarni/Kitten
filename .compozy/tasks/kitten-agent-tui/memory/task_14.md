# Task Memory: task_14.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- First-run flow (repo requirement + per-agent readiness gaps) + compiled-binary/npm packaging (ADR-006). Done + verified.

## Important Decisions
- First-run split: `src/config/firstRun.ts` pure (`buildFirstRunReport`/`formatFirstRunReport`/`readinessSetup`/`isInsideRepo` fs seam). Boot gate in `main()` (`src/index.ts`): repo check BEFORE renderer/spawn; readiness gate AFTER controller (blocks only when zero agents ready). `main()` now returns `BootedCockpit | null`; gate seams `cwd/checkRepo/reportFirstRun/onBlocked`.
- Self-check for compiled artifact: `--self-check` flag → `src/app/selfCheck.ts runSelfCheck()`. Uses `@opentui/react/test-utils testRender` (dynamic import) to drive the React commit headlessly; a plain `createTestRenderer + createRoot` never commits (empty frame). Renders real controller with `createOfflineConnection` (never spawns agents; both not-ready, status strip still paints names). Prints frame + `SELF-CHECK OK`, exit 0.
- `main.tsx` exposes `cockpitElement(controller, recorder?)` so live renderer and self-check mount the same tree.
- Packaging: `scripts/build.ts` (BUILD_TARGETS = 4, `buildAll`, `compileCommand`, `hostTarget`/`resolveTargets`, SHA256SUMS). CLI defaults to HOST target (single machine cannot cross-compile OpenTUI - only host native FFI pkg installed). `scripts/install.sh` sourceable (BASH_SOURCE guard) with `verify_checksum`/`checksum_for`/`detect_platform`. `package.json`: removed `private`, added `files`/`engines`/`publishConfig`, `build`→scripts/build.ts, `build:local`, `selfcheck`; shebang added to `src/index.ts`.
- CI: `.github/workflows/ci.yml` (typecheck+coverage), `release.yml` (matrix builds each target on its NATIVE runner via `bun run scripts/build.ts <platform>`, self-checks, publishes binaries + npm on release).

## Learnings
- `bun build --compile` SUCCEEDS at bun 1.3.13 for host + `--target=bun-<os>-<arch>` (stale MEMORY note said it fails). Cross-compile of OpenTUI FAILS on one machine: `import("@opentui/core-<plat>")` unresolved unless that platform pkg installed (optional deps skipped by os/cpu). Hence native-per-runner CI.
- `createOfflineConnection` unused methods (newSession/prompt) uncovered by controller path → covered by direct unit test to hold per-file 0.8.

## Files / Surfaces
- New: src/config/firstRun.ts(+test), src/app/selfCheck.ts, scripts/build.ts, scripts/install.sh, .github/workflows/{ci,release}.yml, test/{build,build.integration,install,firstRunBoot}.test.ts.
- Modified: src/index.ts (gates, self-check dispatch, shebang), src/ui/main.tsx (cockpitElement), package.json.

## Errors / Corrections
- First `bun run scripts/build.ts` (all 4) failed cross-compiling darwin-x64 → changed default to host target only.

## Ready for Next Run
- Verified: typecheck 0, `bun test` 456/456, `bun test --coverage` exit 0, host build+self-check exit 0, installer tamper rc=1.
- Release publish (`bun publish`, binary upload) is gated on a GitHub release event; not run locally.
