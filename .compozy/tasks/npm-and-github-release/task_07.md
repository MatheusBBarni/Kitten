---
status: pending
title: "Node launcher and package.json restructure"
type: infra
complexity: high
dependencies:
  - task_06
---

# Task 07: Node launcher and package.json restructure

## Overview
For `npx kitten` to run without Bun, the main npm package must become a thin Node launcher that resolves the right platform package's binary, with the four platform packages declared as `optionalDependencies`.
This task adds `bin/kitten.mjs`, restructures `package.json` from shipping raw TypeScript to shipping the launcher, promotes `npx kitten` to the README hero, and proves the Bun-free path with a local-pack install test.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `bin/kitten.mjs`, a Node-compatible launcher that maps `process.platform`/`process.arch` to a slug, resolves `@kitten/<slug>/kitten-<slug>` via `createRequire`, execs it with the user's argv/stdio, and fails loud with the Release URL when unresolved.
- MUST restructure `package.json`: `bin` -> `bin/kitten.mjs`, `files: ["bin"]`, exact-pinned `optionalDependencies` on the four `@kitten/<slug>` packages, and drop the Bun-only source-shipping shape (`files: ["src",...]`, `engines.bun` on the shim).
- MUST finalize the README to lead with `npx kitten` (hero) and `npm i -g kitten`, with a version-stamped install success expectation.
- MUST verify the launcher works under Node without Bun via a local-pack + install test on the host platform.
- MUST NOT add any install scripts (`hasInstallScripts` stays false).
</requirements>

## Subtasks
- [ ] 7.1 Add `bin/kitten.mjs` (resolve platform binary + exec + loud failure)
- [ ] 7.2 Restructure `package.json` `bin`/`files`/`optionalDependencies`, drop the Bun-only shape
- [ ] 7.3 Promote `npx kitten` to the README hero + version-stamped install note
- [ ] 7.4 Add a local-pack Bun-free install test (pack shim + host platform pkg, install to temp, run under `node`)
- [ ] 7.5 Confirm no install scripts are present

## Implementation Details
New `bin/kitten.mjs`; modify `package.json` per the TechSpec "Data Models" (main-package shape); finalize `README.md` (hero) started in task_02.
The launcher resolves the binary that task_06 produces, using `node:child_process`/`node:module` only.
See the TechSpec "Core Interfaces" (launcher) and ADR-001.

### Relevant Files
- `bin/kitten.mjs` - new launcher
- `package.json` - `bin` (~L7), `files` (~L10), `engines` (~L15); add `optionalDependencies`
- `README.md` - hero install (finalize `npx`)
- `test/` - new local-pack Bun-free install test (colocate with existing `test/*.integration.test.ts`)

### Dependent Files
- `scripts/build.ts` platform packages (task_06) - the launcher resolves them
- `.github/workflows/release.yml` (task_08) - publishes the shim + platform packages this task defines

### Related ADRs
- [ADR-001: V1 scope for the automated release train](../adrs/adr-001.md) - main shim + optionalDependencies platform packages
- [ADR-002: V1 product scope - self-describing install](../adrs/adr-002.md) - C1 install without Bun, README hero

## Deliverables
- `bin/kitten.mjs` resolving and exec-ing the platform binary under Node
- Restructured `package.json` (shim shape, no install scripts)
- README leading with `npx kitten`
- Local-pack Bun-free install integration test **(REQUIRED)**
- Test coverage >=80% on the launcher's pure logic **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] the launcher maps `darwin`/`linux` x `arm64`/`x64` to the correct `@kitten/<slug>` name
  - [ ] on an unsupported platform/arch it prints the Release URL and exits non-zero
  - [ ] `package.json` `bin` points at `bin/kitten.mjs`, `files` is `["bin"]`, and `optionalDependencies` exact-pins the four `@kitten/<slug>` packages
  - [ ] the package declares no install scripts (`scripts` has no `postinstall`/`preinstall`)
- Integration tests:
  - [ ] local-pack: `npm pack` the shim + host platform package, install into a temp dir, run the installed `kitten` under `node` (not bun) and assert `--version` prints the package version and `--self-check` prints `SELF-CHECK OK`
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The launcher runs the correct binary under Node without Bun (proven by local-pack)
- `package.json` ships the shim, not source, with no install scripts
- The README hero is `npx kitten`
