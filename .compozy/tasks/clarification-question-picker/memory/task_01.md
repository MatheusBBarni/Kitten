# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add protocol-free fail-closed clarification capability classification for resolved provider recipes, expose it without affecting readiness, and add hermetic plus opt-in real-adapter contract coverage.

## Important Decisions

- Production verified recipes remain empty unless the credentialed real-adapter contract passes for the exact built-in adapter/version; tests may inject verified evidence to cover the supported branch.
- Display names are excluded from recipe identity, while provider kind, command, ordered args, full environment, adapter package, and exact version are identity-bearing.

## Learnings

- The pinned Claude adapter forwards its structured `AskUserQuestion` tool through ACP elicitation only when the client advertises `elicitation.form`; no equivalent verified Codex bridge was found, so neither built-in recipe is enabled in production.
- A skipped contract run cannot produce allowlist evidence. The production contract-results catalog therefore remains empty until an authenticated, credentialed adapter run passes all five checks for one exact recipe and SDK release.

## Files / Surfaces

- Added the protocol-free classifier and unit coverage in `src/config/clarificationCapability.ts` and `src/config/clarificationCapability.test.ts`.
- Carried resolved capability through `src/core/types.ts`, `src/config/configLoader.ts`, and `src/config/readiness.ts`; updated their focused regressions plus affected first-run and persistence fixtures.
- Added the opt-in credentialed gate in `test/clarificationAdapter.contract.test.ts`, exact adapter dev-dependency pins in `package.json`/`bun.lock`, age-guard exclusions in `bunfig.toml`, and pin regressions in `test/dependencies.test.ts`.

## Errors / Corrections

- `bun install` initially rejected both exact adapter dev dependencies and their adapter runtimes under the 14-day age guard; added only the two contract packages plus their three blocked runtime dependencies to `minimumReleaseAgeExcludes`, with the direct pins unchanged.

## Ready for Next Run

- Final evidence: typecheck passed; full suite and full coverage each passed with 1402 tests, 2 expected opt-in skips, and 0 failures; coverage was 97.33% functions/98.30% lines overall and 100%/100% for the classifier; the local compiled artifact built successfully.
- The credentialed actual-adapter test was not opted in during this run. To create evidence for a future allowlist entry, authenticate the target provider and run `KITTEN_CREDENTIALED_CLARIFICATION_CONTRACT=1 KITTEN_CLARIFICATION_CONTRACT_PROVIDER=<claude-code|codex> bun test test/clarificationAdapter.contract.test.ts`, then commit a reviewed complete passing result for that exact recipe.
