---
status: completed
title: Relocate Cockpit runtime, launcher, and build surface into packages/tui
type: refactor
complexity: critical
---

# Task 02: Relocate Cockpit runtime, launcher, and build surface into packages/tui

## Overview

Move the preserved Cockpit runtime, CLI launcher, and compile implementation to
packages/tui without redesigning controller, store, UI, ACP, or JSON-persistence
ownership. This is the first compatibility-gated relocation slice required to
make packages-only application boundaries real.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Cockpit source, launcher, and compile implementation MUST become packages/tui-owned without behavior redesign.
2. ENTRYPOINT, version lookup, launcher package-root resolution, and worker embedding MUST resolve package-locally.
3. CLI flags, self-check, artifact names, npm shim behavior, and platform metadata MUST remain compatible.
4. Root source, build, and bin aliases MUST be temporary named compatibility bridges only and MUST NOT move ACP or controller ownership into engine.
5. Targeted package-local build, launcher, and self-check evidence MUST prove the preserved runtime contract.
</requirements>

## Subtasks

- [x] 2.1 Relocate the preserved Cockpit source tree into the TUI package.
- [x] 2.2 Establish the narrowly scoped source compatibility bridge.
- [x] 2.3 Relocate the compile surface and package-local entrypoint resolution.
- [x] 2.4 Establish the temporary build compatibility bridge.
- [x] 2.5 Relocate bin surfaces while preserving shim behavior.
- [x] 2.6 Prove package-local build, launcher, and self-check compatibility.

## Implementation Details

Use the TechSpec Impact Analysis and ADR-007 migration gates. Directory-level
migration roots are deliberate, reviewable relocation surfaces; preserve internal
relative imports and defer contract-suite relocation to its own task.

### Relevant Files

- src/ to packages/tui/src/ — preserved Cockpit runtime tree.
- root src compatibility bridge — temporary legacy import surface.
- scripts/build.ts to packages/tui/scripts/build.ts — package-local compile implementation.
- root build compatibility bridge — temporary legacy build import surface.
- bin/ to packages/tui/bin/ — CLI and npm shim ownership.
- root bin compatibility bridge — temporary public-entry compatibility.
- packages/tui/package.json — package runtime scripts and metadata.

### Dependent Files

- packages/tui/src/index.ts — compiled and self-check entrypoint.
- packages/tui/test/build.test.ts — build contract coverage.
- packages/tui/test/npm-launcher.integration.test.ts — launcher compatibility proof.

### Related ADRs

- [ADR-003: Establish the packages-only workspace before desktop delivery](adrs/adr-003.md) — packages-only target.
- [ADR-007: Stage the Cockpit workspace relocation behind compatibility gates](adrs/adr-007.md) — bridge ownership and removal.

## Deliverables

- Cockpit runtime, build, and launcher owned by packages/tui.
- Explicit, temporary compatibility bridges for remaining contract consumers.
- Package-local build and launcher compatibility evidence.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for launcher, build, and self-check **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Import the package-local build module and assert package-local entrypoint resolution.
  - [x] Preserve artifact-name, worker-embedding, platform-package, and version lookup behavior.
  - [x] Exercise package-local and bridge resolution branches.
- Integration tests:
  - [x] Run the package-local self-check and host-local compile.
  - [x] Run the published launcher fixture against the package-local bin.
  - [x] Verify compiled output retains self-check and provenance behavior.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- TUI typecheck, focused build suites, self-check, and local build succeed.
- Every remaining root bridge has an explicit removal owner.
