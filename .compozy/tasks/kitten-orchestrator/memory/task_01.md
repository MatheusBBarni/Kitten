# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Establish the private `apps/*` workspace boundary while preserving the public Cockpit package contract and root Bun policy.

## Important Decisions

- Keep Task 01 structural: do not introduce a temporary root-source compatibility bridge while runtime relocation remains owned by Task 02 and final command/CI delegation remains owned by Task 04.
- Preserve the dirty worktree and stage only Task 01 package, configuration, contract-test, memory, and tracking surfaces.

## Learnings

- Pre-change signal on 2026-07-17: root `private` and `workspaces` are absent, and `apps/cockpit/package.json` does not exist.
- Existing focused package/dependency/CI contracts pass before the change: 13 tests, 0 failures.
- Bun 1.3 workspace documentation confirms private-root workspace globs, named `bun run --filter <package> <script>` delegation, and frozen-install failure when manifests conflict with `bun.lock`.

## Files / Surfaces

- Planned: `package.json`, `apps/cockpit/package.json`, `apps/cockpit/tsconfig.json`, root package/config contract tests, `bun.lock` only if workspace metadata requires refresh.

## Errors / Corrections

- The task graph creates delegates before runtime relocation. Avoid app scripts that reach back to root `src/`; those would violate ADR-003's app-local CWD boundary.
- Blocking contract conflict: Task 01 requires filtered root commands plus all tests/typecheck passing, but Task 02 exclusively owns moving `src/`, `test/`, `bin/`, and build tooling into the app package. App-local scripts cannot run before that move; temporary `../../src` scripts or root-CWD wrappers violate ADR-003 and the TechSpec.

## Ready for Next Run

- Task remains pending with no implementation or tracking changes. Resume only after the packet is corrected to make Tasks 01 and 02 atomic, or after an explicit contract change authorizes a temporary migration bridge and its verification expectations.
