---
status: completed
title: Relocate Cockpit contract suite and remove source/test compatibility bridges
type: refactor
complexity: critical
---

# Task 03: Relocate Cockpit contract suite and remove source/test compatibility bridges

## Overview

Relocate the Cockpit test and fixture surface alongside its production package,
then remove the temporary source/test compatibility bridges. This turns the
staged relocation into an independently verifiable package-local Cockpit suite.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Colocated Cockpit tests, root contract tests, and shared fixtures MUST live with their package-local production surfaces.
2. TUI test, typecheck, coverage, and self-check commands MUST resolve only package-local application files.
3. Relocation-driven import and configuration changes MUST preserve test intent and Cockpit behavior.
4. Temporary root source/test bridges and stale root test configuration MUST be removed after package-local consumers own the surface.
5. A regression contract MUST prove that no root Cockpit source/test ownership remains.
</requirements>

## Subtasks

- [x] 3.1 Relocate colocated source tests with their production modules.
- [x] 3.2 Relocate contract tests and shared fixtures into packages/tui/test.
- [x] 3.3 Make package-local typecheck, test, coverage, and self-check authoritative.
- [x] 3.4 Add the root-ownership regression contract.
- [x] 3.5 Remove temporary source/test bridges and stale configuration.
- [x] 3.6 Run the preserved Cockpit contract suite from the workspace.

## Implementation Details

Follow the TechSpec packages/tui boundary and ADR-007. This is a test-surface
relocation, not an ACP, UI, or controller behavior rewrite.

### Relevant Files

- packages/tui/src/ and colocated tests — package-owned Cockpit source contracts.
- packages/tui/test/ — migrated integration tests and fixtures.
- packages/tui/package.json — package test and coverage scripts.
- packages/tui/tsconfig.json — test discovery policy.
- tsconfig.json — root workspace compiler coordination.
- temporary root src/ and test/ bridges — removal surface.

### Dependent Files

- packages/tui/test/workspaceBoundary.integration.test.ts — package ownership proof.
- packages/tui/test/reactTui.ts — migrated renderer fixture.
- packages/tui/test/mockAgent.ts — migrated ACP fixture.

### Related ADRs

- [ADR-003: Establish the packages-only workspace before desktop delivery](adrs/adr-003.md) — prevents root application ownership.
- [ADR-007: Stage the Cockpit workspace relocation behind compatibility gates](adrs/adr-007.md) — requires fresh compatibility evidence.

## Deliverables

- Package-local Cockpit source, tests, fixtures, and lifecycle commands.
- Removed root source/test compatibility bridges.
- Regression contract for packages-only Cockpit ownership.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for package-local boot and suite execution **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Preserve relocated ACP, controller, renderer, and build test assertions.
  - [x] Reject root application source/test ownership in the workspace-boundary contract.
  - [x] Verify package-local TypeScript discovery excludes removed bridges.
- Integration tests:
  - [x] Run package-local typecheck, complete test suite, coverage, and self-check.
  - [x] Verify package-local boot resolves the real Cockpit tree.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- No root Cockpit source/test compatibility bridge remains.
- Package-local Cockpit scripts are the only authoritative test lifecycle.
