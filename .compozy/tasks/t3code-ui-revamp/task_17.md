---
status: pending
title: Build the packaged native lifecycle verification harness
type: infra
complexity: high
---

# Task 17: Build the packaged native lifecycle verification harness

## Overview

Build deterministic infrastructure for seeding, launching, driving, capturing,
and verifying the packaged Electrobun supervision experience. Completion
requires real native artifacts for the versioned lifecycle matrix; automated
harness tests and browser screenshots alone do not satisfy this gate.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. A versioned matrix MUST cover every layout-, trust-, and action-changing lifecycle state defined by the TechSpec.
2. Fixtures MUST seed deterministic host-owned SQLite/worktree state and MUST NOT rely on renderer-only mocks or real user data.
3. The runner MUST build and launch the packaged Electrobun application, reject browser/dev-server targets, and select only declared fixtures.
4. Native captures MUST cover stable wide, medium, and narrow windows plus supported theme and reduced-motion variants.
5. Each artifact MUST have a manifest entry with matrix version, fixture ID, state, window size, preference mode, platform, build identity, timestamp, hash, and result.
6. Missing, duplicate, stale, zero-byte, or mismatched artifacts MUST fail verification, and child processes MUST terminate after success, failure, or interruption.
7. The task MUST remain incomplete until real packaged captures are reviewed or an explicit product-owner waiver enumerates missing states and reasons.
</requirements>

## Subtasks

- [ ] 17.1 Define the authoritative versioned lifecycle/window/preference matrix.
- [ ] 17.2 Seed deterministic host persistence and worktree fixtures.
- [ ] 17.3 Build and launch the packaged app with safe fixture selection.
- [ ] 17.4 Drive native interactions and capture screenshots or recordings.
- [ ] 17.5 Emit and validate artifact metadata, hashes, completeness, and freshness.
- [ ] 17.6 Add package commands and reliable process cleanup.
- [ ] 17.7 Execute and review the complete native matrix.

## Implementation Details

Follow the TechSpec **Acceptance and Native Visual Verification** and ADR-006.
This task creates reusable verification infrastructure as well as the required
evidence. Fixtures must pass through host persistence/projections, and capture
artifacts must never contain real repository paths, credentials, prompts, or
user workspace content.

### Relevant Files

- `packages/desktop/test/native/lifecycle-matrix.v1.json` — authoritative lifecycle/window/preference matrix.
- `packages/desktop/test/native/seedLifecycleFixture.ts` — deterministic host-owned fixture builder.
- `packages/desktop/test/native/runLifecycleCapture.ts` — packaged launch, interaction, capture, metadata, and cleanup runner.
- `packages/desktop/test/native/lifecycleCapture.test.ts` — matrix, artifact, target, and process checks.
- `packages/desktop/package.json` — seed, capture, and verification commands.
- `packages/desktop/electrobun.config.ts` — fixture selection without changing production defaults.

### Dependent Files

- `packages/desktop/test/desktopSmoke.integration.test.ts` — shares governed lifecycle builders and prevents fixture drift.

### Related ADRs

- [ADR-001: Adopt a T3 Code-Inspired Supervision Loop While Preserving Kitten's Workflow Model](adrs/adr-001.md) — native evidence remains separate from automated gates.
- [ADR-002: Make Blocked Work and Evidence-Bound Review First-Class](adrs/adr-002.md) — inbox and review-state semantics.
- [ADR-004: Persist Immutable Review Evidence and Page Diffs by File](adrs/adr-004.md) — evidence states to capture.
- [ADR-005: Treat Enter as Prompt Authorization and Dispatch FIFO at Safe Boundaries](adrs/adr-005.md) — queued/interrupted/request-changes states.
- [ADR-006: Require Packaged Native Lifecycle-Matrix Verification](adrs/adr-006.md) — authoritative completion gate.

## Deliverables

- Deterministic packaged-app fixture, launch, capture, cleanup, and artifact-verification infrastructure.
- Complete reviewed native lifecycle evidence manifest and artifacts.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for packaged target selection, deterministic fixtures, and process cleanup **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Require every matrix state to have a unique stable fixture identity.
  - [ ] Generate equivalent SQLite projections from repeated fixture seeding.
  - [ ] Reject browser/dev-server targets and unsupported fixture IDs.
  - [ ] Require build identity, fixture/state, window dimensions, timestamp, platform, and matching hash for each artifact.
  - [ ] Fail missing, duplicate, stale, zero-byte, and hash-mismatched artifacts.
  - [ ] Terminate packaged and capture processes after success, failure, and interruption.
- Integration tests:
  - [ ] Capture empty/populated inbox and every actionable lifecycle group.
  - [ ] Capture running direct-send queued/interrupted behavior with no confirmation UI.
  - [ ] Capture failed, ready-review, text/binary/too-large, and stale-evidence states.
  - [ ] Capture mutation-free Request changes selection and same-card/stage explicit send.
  - [ ] Capture board restoration, Settings return, visible focus, and wide/medium/narrow layouts.
  - [ ] Capture supported light/dark and reduced-motion variants without real user content.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every required matrix state has a reviewed real packaged Electrobun artifact.
- Browser screenshots or automated tests are never misreported as native visual proof.
