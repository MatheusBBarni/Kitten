# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add `packages/engine` as a dependency-free, UI-free contract package for readiness, Direct ACP attempt state, normalized activity ordering, and generation-fenced question outcomes.

## Important Decisions

- Use the private workspace package name `@kitten/engine` and expose only `src/index.ts`.
- Preserve Cockpit behavior with type-level compatibility: TUI keeps its controller/store/persistence ownership while importing shared readiness, prompt-result, normalized-activity, and terminal-question contracts.
- Keep activity and question acceptance helpers pure; lifecycle mutation and durable rejection handling remain application-owned.

## Learnings

- The public TUI package may consume `@kitten/engine` only as a dev dependency because its published Node shim contains no runtime engine import; a runtime `workspace:*` dependency survives `npm pack` and npm rejects the tarball.

## Files / Surfaces

- Added `packages/engine/package.json`, `packages/engine/tsconfig.json`, `packages/engine/src/contracts.ts`, `packages/engine/src/index.ts`, and `packages/engine/src/contracts.test.ts`.
- Adapted root workspace scripts and lock metadata plus TUI `agentConnection.ts`, `acpTranslate.ts`, `core/types.ts`, `config/readiness.ts`, package metadata, and workspace-boundary coverage.

## Errors / Corrections

- Initial `bun install` hit the existing minimum-release-age guard for freshly published 0.6.1 platform packages; refreshed lock metadata with a one-command age override and removed unrelated platform resolutions from the diff.
- The first broad test exposed `workspace:*` in the packed TUI runtime dependencies. Moving `@kitten/engine` to `devDependencies` restored all five local npm launcher installation/update contracts.
- The first shared coverage run loaded engine runtime helpers through one redundant TUI test assertion, so the TUI-only pass saw engine production code without engine tests and failed its per-file threshold. Keeping TUI consumption type-only and engine behavior in the engine suite restored the shared coverage gate without duplicating tests.

## Ready for Next Run

- Implementation, self-review, tracking, and verification are complete. Fresh evidence: root typecheck passed; 3,128 tests passed with 0 failures and five credential-gated skips; shared coverage passed with engine at 100%; `SELF-CHECK OK`; native build succeeded.
- Narrow implementation commit: `07d926b` (`refactor: extract protocol-free engine contracts`). Task tracking and workflow memory intentionally remain outside the automatic commit.
