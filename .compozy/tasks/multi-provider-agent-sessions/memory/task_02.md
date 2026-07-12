# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
Rework `AppConfig` from fixed `agents` array to `providers: Record<ProviderKind, ProviderRecipe>` + `sessions: SessionDescriptor[]` + `telemetryEnabled`. Add a resolver (`resolveSessions`) producing ordered per-session spawn+cwd inputs (`ResolvedSession { seed, spawn }`) the controller consumes. Zero-config = one session per provider in launch dir, preserving today's two-session behavior (id=providerKind, title=displayName).

## Important Decisions
- `ProviderRecipe = { displayName; command; args; env }` (no id; keyed by ProviderKind in the map). `AgentConfig` kept as spawn recipe `{ id; ...ProviderRecipe }` for the agent/transport/connection layer.
- `ResolvedSession = { seed: SessionSeed; spawn: AgentConfig }` maps 1:1 onto the controller's existing `{ seed, config }` plan entry.
- Id assignment for repeated providers: first occurrence of a provider = `providerKind`, k-th (k>=2) = `${providerKind}-${k}`. Keeps default fleet ids == providerKind.
- Zero-config: synthesize descriptors carrying explicit `title = displayName` so today's titles are preserved; explicit descriptors default `title = basename(cwd)`.
- cwd existence check (2.5) applies ONLY to explicitly-declared sessions, via injectable `dirExists` probe (default existsSync); skipped for the synthesized zero-config default so the launch dir is a given (and controller.test with fake CWD + sessions:[] stays green). Missing `cwd` field / empty string is caught at the zod layer.
- Legacy `agents` key accepted as alias for `providers` (deprecation window, ADR-005 SHOULD).
- Scope boundary: index.ts still injects a default-seeded store; wiring custom sessions into the store end-to-end is task_03 (already the documented Open Risk). Not fixed here.

## Learnings
- `Record<ProviderKind, ProviderRecipe>` is a finite-union mapped type, so indexing it with a `ProviderKind` yields `ProviderRecipe` (NOT `| undefined`) even under `noUncheckedIndexedAccess` - no guard needed on `.displayName`. Contrast: `PROVIDER_KINDS[0]` (array index) IS `| undefined`, so `.map(...).find(Boolean)` is the clean way to pick the first configured provider (used in selfCheck).
- Existence probe placement (2.5 vs ADR-005): resolveSessions probes `cwd` only for EXPLICITLY declared sessions (default `existsSync`), and throws `ConfigError` for a non-existent path (config typo, fail loud). The zero-config launch dir is never probed. A dir that exists-but-is-non-repo is NOT a load error - that stays per-session readiness (task_04/firstRun). This split satisfies 2.5 without violating ADR "don't block the fleet".
- Controller/UI/readiness tests that built `{ agents: [...] }` now build `{ providers: {...}, sessions: [] }`; single-provider tests (controller.test 355/513) became a single declared session with `cwd: process.cwd()` so the real existsSync probe passes.
- `checkAllAgentsReadiness` (readiness.ts) now iterates `PROVIDER_KINDS` over `config.providers` (readiness is per-provider spawn recipe, not per-session).

## Files / Surfaces
- `src/core/types.ts` - AppConfig reshape; add ProviderRecipe, SessionDescriptor, ResolvedSession.
- `src/config/configLoader.ts` - schema/defaults/merge rewrite + resolveSessions + findAgentConfig rewrite.
- `src/app/controller.ts` - plan built from resolveSessions (bridge; fuller rewire is task_03).
- `src/app/selfCheck.ts` - marker derived from providers, not config.agents.
- `src/config/configLoader.test.ts`, `src/app/controller.test.ts` - update fixtures to new shape; add new tests.

## Errors / Corrections

## Ready for Next Run
- task_03 (controller): the controller already builds its plan from `resolveSessions(config, { launchCwd: cwd })` mapping `resolved.seed`/`resolved.spawn` - the plumbing is done. task_03's remaining work is the fuller rewire (approvals carrying cwd is already present; store-seeding move; jumpToNextNeedy; etc.).
- STILL OPEN (shared Open Risk): `index.createCockpitSession` injects a default-seeded `createAppStore()` into the controller. For non-default `sessions` configs, that external store's seeds diverge from the controller's resolved sessions. Not fixed here (out of task_02 scope). task_03 must move store seeding into the controller or seed it from `resolveSessions`.
