# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implement the Node-only global npm ownership proof and exact update transaction in `bin/`, with deterministic unit and packed-package integration coverage.

## Important Decisions

- Preserve every invocation containing `--version` or `--help` through the existing compiled-binary forwarding path before considering `--update`.
- Refuse ambiguous npm provenance inside the launcher; never delegate rejected update invocations to the compiled standalone updater.
- Treat the canonical resolved binary directory as the platform package root, validate both package manifests and matching pre-update versions, and require the main root, platform root, and binary to be strict descendants of the one canonical npm global root.
- Use fresh `package.json` reads before and after the exact inherited-stdio npm install; do not use `require()` for version reads.

## Learnings

- The pre-change launcher forwarded `--update` directly to the compiled binary; an injected baseline trace captured the resolve then binary-spawn sequence.
- Packed integration fixtures can exercise all npm routing under Node without executing Bun by packing a dummy host platform binary and placing the real shim in controlled local, `_npx`, and global layouts.
- Keep packed update expectations version-agnostic by reading the prior version from `package.json`; hard-coding the current release would make the test fail on the next release bump.

## Files / Surfaces

- Touched: `bin/kitten.mjs`, `bin/launcher.mjs`, `test/launcher.test.mjs`, and `test/npm-launcher.integration.test.ts`.
- Final focused evidence: 27 launcher unit cases pass with 100% function / 97.98% line coverage; 5 packed launcher integration cases pass.
- Final broad evidence: typecheck, full Bun test suite, headless self-check (`SELF-CHECK OK`), host build, and `git diff --check` pass after the last implementation/test change.

## Errors / Corrections

- The worktree already contains unrelated staged and unstaged changes, including `src/index.ts` and other task tracking. Preserve them and stage only task 05 surfaces plus its task memory/tracking when eligible.

## Ready for Next Run

- Task 05 implementation and evidence are complete in local commit `61f8336`; task 06 can document the verified npm channel and exact recovery behavior.
