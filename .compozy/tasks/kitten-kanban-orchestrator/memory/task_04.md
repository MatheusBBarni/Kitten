# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Rebase all Cockpit delivery consumers on `packages/tui`, preserve public commands/artifacts/provenance, then remove the remaining root build/bin bridges.

## Important Decisions

- Keep `scripts/install.sh` at its canonical public URL; move the README checker and all other delivery ownership package-local.
- Use release-please component path `packages/tui`; component-relative `package.json` extra-file paths preserve platform pin updates and the default component tag remains `kitten-v<version>`.
- Keep root lifecycle scripts as workspace forwarding commands, but remove duplicated public metadata and dependency ownership from the private coordinator.

## Learnings

- Tasks 01-03 are now implemented in the current checkout; the older missing-prerequisite blocker no longer applies.
- Baseline delivery contracts pass while explicitly asserting the obsolete root bridges and root release ownership, proving Task 04 remains incomplete rather than exposing a behavioral regression.
- npm treats bare `packages/tui` as a GitHub shorthand; package publication must use `./packages/tui`.
- Bun regenerated dependency ownership but retained the stale root lockfile name, so the lock contract now asserts the private coordinator name and frozen install verifies it.

## Files / Surfaces

- Touched: root and TUI manifests/lockfile, CI/release workflows, release-please metadata, README/changelog, package-local delivery tests/checker, and final build/bin bridges.

## Errors / Corrections

- Corrected the initial bare npm publication path after dry-run resolution failed; the release workflow now stages the root README and publishes `./packages/tui`.
- Removed the final bridges only after the package-local compiled/packed/installer delivery set passed with 128 tests and zero failures.
- The first repo-wide gate found one stale site docs contract loading the removed root `src/config/configLoader.ts`; corrected it to the package-local runtime schema path before restarting verification.
- A direct package-context coverage probe showed same-binary MCP tests rely on the historical workspace cwd; retained package-owned lifecycle scripts with explicit `--cwd ../..` and package-local target paths instead of changing runtime cwd semantics.
- Corrected the CI coverage contract after restoring workspace cwd so it asserts both isolated execution and explicit package-local source/test targets.
- Corrected the package-boundary integration contract to the same explicit workspace-cwd lifecycle strings; a concurrent ApprovalPrompt timing failure in the interrupted repo-wide run was outside Task 04 and is being rechecked by the fresh full suite.
- The fresh repo-wide rerun passed; the earlier ApprovalPrompt failure was timing noise and required no out-of-scope change.
- The workspace coverage wrapper did not return after its Bun child exited, so the identical direct Bun coverage command supplied authoritative exit-zero evidence.

## Ready for Next Run

- Verification is clean: frozen install, typecheck, self-check, native build/checksum, task-packet validation, diff check, 3,118 passing repo tests with five credentialed probes skipped, and 3,044 passing package coverage tests above the 80% floor.
- Implementation was committed locally as `002f768` (`refactor(tui): rebase public delivery on package`). Preserve unrelated Task 01/02 tracking edits; Task 04 tracking and the untracked workflow-memory directory were intentionally kept outside the implementation commit.
