---
status: completed
title: Establish private workspace and TUI package boundary
type: infra
complexity: high
---

# Task 01: Establish private workspace and TUI package boundary

## Overview

Turn the repository root into a private Bun workspace coordinator and establish
packages/tui as the Cockpit application's first package boundary. This creates
the migration-safe ownership model without changing Cockpit behavior.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. The root manifest MUST be private, declare packages/* workspace membership, and contain no independent Cockpit runtime lifecycle.
2. packages/tui/package.json MUST own the current public package identity, exact dependency pins, bin metadata, and Cockpit scripts.
3. Root forwarding scripts MAY invoke the TUI package during migration but MUST NOT introduce a second application lifecycle.
4. TypeScript strictness, OpenTUI JSX policy, Bun lock integrity, and existing release-age policy MUST remain unchanged.
5. A focused contract test MUST reject a non-private root, root runtime entrypoint, or missing TUI lifecycle ownership.
</requirements>

## Subtasks

- [x] 1.1 Convert root metadata into workspace-only coordination.
- [x] 1.2 Create the TUI manifest with the preserved published Cockpit contract.
- [x] 1.3 Establish package-local TypeScript configuration with the existing compiler policy.
- [x] 1.4 Adjust root TypeScript discovery for the temporary package boundary.
- [x] 1.5 Add workspace ownership and forwarding contract coverage.
- [x] 1.6 Regenerate and inspect the lockfile without unrelated upgrades.

## Implementation Details

Follow the TechSpec System Architecture and staged build order. This task
establishes package ownership only; Cockpit source relocation remains a later
migration slice.

### Relevant Files

- package.json — root workspace and forwarding-script contract.
- bunfig.toml — existing Bun package policy, if present.
- tsconfig.json — root compiler discovery boundary.
- packages/tui/package.json — new Cockpit package manifest.
- packages/tui/tsconfig.json — package-local strict compiler policy.
- test/workspaceBoundary.test.ts — new ownership regression contract.

### Dependent Files

- bun.lock — workspace resolution evidence.
- packages/tui/src/index.ts — future package runtime entrypoint.
- packages/tui/test/workspaceBoundary.integration.test.ts — package-local migration proof.

### Related ADRs

- [ADR-003: Establish the packages-only workspace before desktop delivery](adrs/adr-003.md) — establishes the boundary.
- [ADR-007: Stage the Cockpit workspace relocation behind compatibility gates](adrs/adr-007.md) — constrains this migration slice.

## Deliverables

- Private workspace root and package-local TUI lifecycle contract.
- Preserved exact dependency versions and compiler policy.
- Workspace ownership regression test.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for workspace forwarding **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Parse both manifests and reject non-private root ownership or missing packages/* membership.
  - [x] Assert the TUI package owns bin and runtime scripts with exact dependency versions.
  - [x] Reject a root script that directly selects the Cockpit source entrypoint.
- Integration tests:
  - [x] Run TUI typecheck through the temporary boundary.
  - [x] Verify a root forwarding command invokes the same TUI lifecycle.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The root has no independent Cockpit runtime entrypoint.
- packages/tui is the sole declared Cockpit application owner.
