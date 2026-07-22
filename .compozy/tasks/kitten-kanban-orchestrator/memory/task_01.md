# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Establish `packages/tui` as the sole Cockpit package/lifecycle owner while the root becomes a private `packages/*` Bun workspace coordinator.

## Important Decisions

- ADR-007 resolves ADR-003's former atomic-move contradiction: Task 01 may leave source and build files at the root only through package-owned relative script bridges; root scripts must forward by workspace package name and must not select Cockpit entrypoints directly.
- Preserve the current public manifest contract and exact dependency pins verbatim in `packages/tui/package.json`; do not add or upgrade dependencies.
- Keep root TypeScript discovery as a coordinator over the package-local compiler policy during the temporary source/test bridge.

## Learnings

- Pre-change evidence: root `private` is absent, root `workspaces` is absent, and `packages/tui/package.json` does not exist.
- Bun 1.3 documents `bun run --filter <package> <script>` for workspace selection and a private root with `workspaces: ["packages/*"]`.
- Fresh final gate passed after all corrections: typecheck; 3,108 passed / 5 credential-dependent skipped / 0 failed in both normal and coverage runs; the configured 80% coverage threshold; `SELF-CHECK OK`; and the compiled Darwin arm64 artifact plus `dist/SHA256SUMS`.

## Files / Surfaces

- Changed: `package.json`, `packages/tui/package.json`, `tsconfig.json`, `packages/tui/tsconfig.json`, `bun.lock`, `test/workspaceBoundary.test.ts`, `packages/tui/test/workspaceBoundary.integration.test.ts`, and existing manifest/compiler ownership contracts under `test/`.

## Errors / Corrections

- Fresh verification exposed that `bun --cwd ../.. test ...` re-entered the root `test` script recursively once executed through the package filter. Package test scripts must put the test subcommand first (`bun test --cwd ../.. ...`) so Bun selects its test runner before applying the root working directory.

- First focused run: ownership unit cases passed, but TUI typecheck found manifest tests still reading root dependencies and optional `spawnSync` output typing. Corrected those tests to read `packages/tui/package.json` and made integration diagnostics strict-safe.
- First full suite: 3106 passed and only the CI coverage-script contract failed because it still read the root forwarding script. Repointed that ownership assertion to the TUI manifest and its temporary test paths.
- Clean-install correction: removing root dependency declarations made root-resident source/tests unable to resolve package dependencies after `bun install --frozen-lockfile`. Keep exact mirrored root dependency pins as the ADR-007 resolution bridge until source/test relocation; root scripts remain forwarding-only.
- Self-review correction: workspace filters execute scripts from the package cwd. Package-owned source/test/build bridges now use Bun's `--cwd ../..` so root forwarding preserves launch-directory and build entrypoint behavior until relocation.

## Ready for Next Run

- Task 01 is complete. Tasks 02-04 may relocate root-resident source, tests, build scripts, and public delivery metadata behind the established `packages/tui` owner; remove the exact mirrored root dependency bridge only when those consumers move.
