---
status: completed
title: Relocate Cockpit Runtime Launcher and Build Tooling
type: refactor
complexity: critical
---

# Task 02: Relocate Cockpit Runtime Launcher and Build Tooling

## Overview

Relocate Cockpit’s runtime, CLI launcher, TypeScript project, and build tool into `apps/cockpit` as one atomic application unit. Preserve byte-for-byte observable behavior: this task changes ownership paths, not the runtime, configuration, local state, or CLI contract.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- The complete `src/` tree, Cockpit bin launchers, `scripts/build.ts`, and TypeScript project MUST relocate under `apps/cockpit` as one VCS move.
- The atomic-directory exception is required: approximately 179 source files use same-tree relative imports and colocated test helpers that would be broken by module-by-module moves.
- `bin/kitten.mjs` and `bin/launcher.mjs` MUST keep their public launcher behavior and relative relationship unchanged.
- The build MUST continue to compile `src/index.ts`, emit the tree-sitter worker secondary entry, and stage the same native package topology under `apps/cockpit/dist`.
- The build MUST execute from Cockpit’s app directory so its entrypoint, worker, output, package-version, and working-directory contracts remain valid.
- Cockpit runtime configuration, local state locations, review/handoff behavior, and user-facing behavior MUST NOT change.
</requirements>

## Subtasks

- [ ] 2.1 Move the complete runtime source tree into `apps/cockpit/src` without changing intra-tree import semantics.
- [ ] 2.2 Move both Cockpit launchers into `apps/cockpit/bin` and retain the public `kitten` bin contract.
- [ ] 2.3 Move the Cockpit build program into `apps/cockpit/scripts` and preserve app-local build output behavior.
- [ ] 2.4 Place the TypeScript project beside the relocated runtime and align its source/test discovery with the new tree.
- [ ] 2.5 Audit relocation-sensitive imports, build entrypoints, worker output, package-version reads, and working-directory assumptions.
- [ ] 2.6 Add relocation contract coverage for compiled artifacts and launcher behavior.

## Implementation Details

This is the approved exception to the normal small-file task boundary: the application tree must remain internally coherent. `src/version.ts` and the build script both resolve `../package.json`; from the Cockpit tree that path must identify the public Cockpit manifest. Preserve the launcher’s platform-binary resolution and the build’s exact package layout.

### Relevant Files

- src/ — complete Cockpit runtime and colocated tests to relocate to `apps/cockpit/src/`.
- bin/kitten.mjs — public CLI shim to relocate to `apps/cockpit/bin/kitten.mjs`.
- bin/launcher.mjs — native-platform launcher to relocate beside the CLI shim.
- scripts/build.ts — Cockpit compiler and native package staging tool to relocate to `apps/cockpit/scripts/build.ts`.
- tsconfig.json — Cockpit project configuration source to place at `apps/cockpit/tsconfig.json`.
- src/version.ts — relative public-manifest version reader.
- src/app/treeSitterWorker.ts — compiled worker-entry contract.

### Dependent Files

- apps/cockpit/package.json — public package manifest read by runtime and build tooling.
- scripts/install.sh — root installer retained as a public release-asset consumer.
- test/build.test.ts — compiled artifact and staging assertions that relocate with the suite.
- test/npm-launcher.integration.test.ts — packed public shim and native launcher assertions that relocate with the suite.

### Related ADRs

- [ADR-003: Make the repository root a private workspace coordinator](adrs/adr-003.md)
- [ADR-005: Preserve Cockpit configuration and local state with no migration](adrs/adr-005.md)

## Deliverables

- A complete Cockpit runtime, launcher, build, and TypeScript project under `apps/cockpit`.
- App-local compiled output and native package staging with unchanged names and contents.
- An audited set of path-sensitive imports and working-directory contracts.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration-style compiled-build and packed-launcher tests with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] `src/version.ts` resolves the Cockpit public manifest version after relocation.
  - [ ] The build retains the primary executable and `parser.worker.js` entrypoint naming contract.
  - [ ] The public bin shim continues to resolve its sibling launcher and platform package name.
  - [ ] No Cockpit source import refers to the old root runtime, bin, or build-tool location.
- Integration tests:
  - [ ] An app-local compiled build produces the expected executable, native package staging tree, and self-check result.
  - [ ] A packed Cockpit shim installs and launches through the expected platform package without Bun at runtime.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Cockpit runs and builds from its own application directory with no behavioral changes.
- The approved atomic relocation leaves no split or stale Cockpit runtime tree at the root.
