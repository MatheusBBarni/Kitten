# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts obvious from the repository, PRD documents, or git history.

## Current State
- Done + verified: task_01..task_14. All PRD tasks complete.
- Baseline after task_14: `bun test` 456/456 pass, `bun run typecheck` clean, `bun test --coverage` exits 0 (per-file 0.8 threshold), `bun run build` (host) + `--self-check` exit 0.
- Entry chain: `src/index.ts` (`createCockpitSession(deps?)` → `{controller, recorder}`; `main()` returns `BootedCockpit|null` behind repo+readiness first-run gates; `--self-check` dispatch) -> `src/ui/main.tsx` (`renderCockpit`/`cockpitElement`) -> `src/ui/CockpitApp.tsx` -> `src/ui/ConversationView.tsx`.
- Packaging: `scripts/build.ts` (compiled binaries, 4 targets), `scripts/install.sh` (checksummed curl installer), `.github/workflows/{ci,release}.yml`, npm-publishable `package.json`.

## Shared Decisions
- ACP SDK is `@agentclientprotocol/sdk` (pinned 1.2.1). Import ACP types only inside `src/agent` (ADR-003); re-export protocol constants as plain values.
- Exact version pinning mandatory (bunfig `install.exact = true`); new deps respect `minimumReleaseAge`.
- `src/index.ts` stays import-side-effect-free (`import.meta.main` guard). JSX only in `.tsx`.
- Config: optional JSON (`KITTEN_CONFIG` -> `$XDG_CONFIG_HOME/kitten/config.json` -> `~/.config/kitten/config.json`), zod-`.strict()`, field-level merge over `defaultAppConfig()`. Invalid config throws `ConfigError`.
- No Zustand. Hand-rolled store + `useSyncExternalStore` (ADR-004). No batching; actions no-op when nothing changes; immutable with structural sharing.
- Redaction biased to false negatives; human preview is the safety control. `assemble` redacts as it builds - callers MUST NOT redact again.
- Factories over classes for public constructors (`createX(...)`), interfaces as the seam.
- All UI colors via `src/ui/theme.ts` (`usePalette()`); never hard-code. `src/ui/keymap.ts` is the single source of truth for dispatch/help; overlays are modal and swallow every key.

## Shared Learnings
- Verification gates: `bun run typecheck` + `bun test` + `bun test --coverage`. `bun build --compile` SUCCEEDS for the HOST target (bun 1.3.13). Cross-compiling to another platform FAILS on one machine: OpenTUI loads its Zig core via `import("@opentui/core-<plat>")` and only the host's platform pkg is installed (optional deps skipped by os/cpu). Release builds each target on its NATIVE CI runner (`release.yml`), never cross-compiles.
- Headless render check: a plain `createTestRenderer + createRoot().render()` never commits React (empty frame); use `@opentui/react/test-utils testRender` to drive the commit. Kitten's `--self-check` (`src/app/selfCheck.ts`) does this to prove the compiled binary boots.
- Never gate on `rtk tsc` (no `tsc` on PATH → false "No errors found"). Use `bun run typecheck`.
- Bun enforces `coverageThreshold` (0.8) PER FILE, not aggregate; non-zero `bun test --coverage` exit is a real regression. Also gates non-test helpers under `test/`, so every helper needs its own test.
- `bun build <file> --target=bun | grep -c <pkg>` proves a type-only import did not breach the ADR-003 boundary.
- zsh has no `PIPESTATUS`; redirect to a file and read `$?` when verification needs a real exit code.
- Non-TTY UI tests: `createTestRenderer`/`testRender` via `test/reactTui.ts`; assert through `waitForFrame`, never a bare capture.

## Open Risks
- Pre-1.0 churn: @opentui/* and the ACP SDK ship breaking changes; keep behind adapter boundaries and re-pin deliberately.
- @opentui/core 0.4.3: `<markdown>` paints nothing unless `streaming` is true; `<scrollbox>` reserves a horizontal-scrollbar row even under `scrollX:false` (pass `horizontalScrollbarOptions={{visible:false}}`). Re-check on bumps.

## Handoffs
Contracts task_14 depends on (signatures live in source; these are the non-obvious parts):

- **task_04 config/readiness** - `loadAppConfig`, `defaultAppConfig`, `findAgentConfig`, `ConfigError`; `checkAllAgentsReadiness(appConfig)` → `AgentReadiness[]` in config order, never throws. `NotReadyReason = binary_not_found | handshake_failed | handshake_timeout | capability_mismatch`, each with a display-ready `message`. task_14 first-run renders these.
- **task_07 controller** (only path UI may use to reach an agent) - `await createSessionController(...)` → `{ store, actions, runtimes(), runtime(agentId), isReady(agentId), dispose() }`. Never rejects.
- **task_08 onward** produces the runnable app rendered by `renderCockpit`/`createCockpitSession`; task_14 bundles this via `bun build --compile`.
