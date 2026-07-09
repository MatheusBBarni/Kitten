# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
Greenfield Bun+TS scaffold: pinned OpenTUI/React/ACP deps, JSX tsconfig for @opentui/react, source layer skeleton, runnable placeholder cockpit entry (Ctrl+C exit), bun test + smoke/config/dep/integration tests, >=80% coverage.

## Important Decisions
- ACP SDK package is `@agentclientprotocol/sdk` (techspec-named, canonical agentclientprotocol org), NOT `@zed-industries/agent-client-protocol`. Pinned exact 1.2.1. It is 1.x, so "pre-1.0" note in task is stale; the hard rule is exact pinning.
- Entry `src/index.ts` must NOT boot renderer on import (smoke test imports it). Guarded by `import.meta.main`; app render logic exported separately (renderCockpit) so integration test drives it with `createTestRenderer` from `@opentui/core/testing`.
- Ctrl+C: createCliRenderer `exitOnCtrlC:true` (default) destroys renderer; wire `renderer.on("destroy", ...)`/process exit for clean process exit.

## Learnings
- Pinned versions: @opentui/core 0.4.3, @opentui/react 0.4.3, react 19.2.7, @agentclientprotocol/sdk 1.2.1.
- @opentui/react peerDeps: react>=19.2.0, ws ^8.18.0, react-devtools-core ^7.0.1. Support pins: ws 8.21.0, react-devtools-core 7.0.1, zod 4.4.3 (ACP peer), @types/react 19.2.17, @types/ws 8.18.1.
- Non-TTY test renderer: `createTestRenderer({width,height})` from `@opentui/core/testing`; use renderOnce()/captureCharFrame()/renderer.destroy(). React root via `createRoot(renderer).render(...)`.
- Bun 1.3.13 installed; typescript latest 6.0.3.

## Files / Surfaces
- New: package.json, tsconfig.json, bunfig.toml, .gitignore, src/index.ts, src/app/CockpitApp.tsx, src/**/.gitkeep layer dirs, tests under src/ or test/.

## Errors / Corrections
- Integration test #1 tore down a mounted React root with a bare `renderer.destroy()`, emitting a non-fatal React `act(...)` warning. Fixed by routing it through the existing `destroyMounted` helper (wraps destroy in `act` + `IS_REACT_ACT_ENVIRONMENT`). Any test that destroys a renderer with a mounted root must use that helper.

## Ready for Next Run
Scaffold DONE and verified: `tsc --noEmit` clean, `bun test` 11/11 pass (no warnings), coverage 100% funcs / 98.25% lines. `bun run src/index.ts` boots and renders the bordered "Kitten" cockpit frame, handles SIGINT. task_02 (domain core) builds on src/core.
