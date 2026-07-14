---
status: pending
title: "Prove the support matrix in self-check and compiled artifacts"
type: test
complexity: high
---

# Task 8: Prove the support matrix in self-check and compiled artifacts

## Overview

Expand Kitten's real-cockpit self-check from one TypeScript example to the declared support matrix, then make the host compiled artifact prove the same evidence. This task changes the product's release assurance path, not only tests: a missing parser asset or default-colored token must fail with an actionable capability name.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. MUST render one canonical Markdown fixture for every supported capability and representative extension-backed diff fixtures in the real self-check cockpit.
- 2. MUST wait for all code renderables to finish highlighting and assert every expected token differs from the prose foreground.
- 3. MUST retain an explicit unknown-label fixture that is visible plaintext and is never counted as highlighted.
- 4. MUST make missing or default-colored evidence name the affected capability and surface without revealing user content.
- 5. MUST prove the host compiled binary emits every expected fixture token and preserves existing version, help, worker, and cleanup checks.
- 6. MUST NOT change the release build command shape or worker extraction contract.
</requirements>

## Subtasks

- [ ] 8.1 Replace singleton self-check syntax fixtures with the manifest-driven matrix.
- [ ] 8.2 Render multiple diff fixtures through the real shared diff surface.
- [ ] 8.3 Add actionable foreground and missing-token assertions.
- [ ] 8.4 Extend compiled-host artifact verification and focused test coverage.

## Implementation Details

Follow the TechSpec **Integration Points**, **Integration Tests**, and **Monitoring and Observability** sections. Use the completed manifest fixtures rather than copying language labels into self-check code; retain the existing worker entry and compiled build command.

### Relevant Files

- `src/app/selfCheck.ts` — current single Markdown/diff sentinels and foreground assertions.
- `src/ui/main.tsx` — self-check-only element shape that renders Markdown and diff content.
- `src/app/selfCheck.test.ts` — in-process self-check assertion coverage.
- `test/build.integration.test.ts` — host compiled artifact and CLI contract test.
- `scripts/build.ts` — existing worker embedding contract that must remain unchanged.

### Dependent Files

- `src/app/selfCheck.ts` — manifest-driven fixture matrix and capability-aware assertions.
- `src/ui/main.tsx` — self-check fixture collection render shape and dimensions.
- `src/app/selfCheck.test.ts` — matrix, default-foreground, and unknown-fallback tests.
- `test/build.integration.test.ts` — compiled binary token-matrix checks.
- `src/ui/syntaxParsers.ts` — exported canonical fixtures consumed by self-check.

### Related ADRs

- [ADR-001: Capability-gated multi-language syntax highlighting](adrs/adr-001.md) — every declared language needs release evidence.
- [ADR-003: Static parser manifest with pre-initialization registration](adrs/adr-003.md) — compiled asset and worker parity.

## Deliverables

- Real-cockpit self-check matrix for every supported Markdown capability and representative diffs.
- Capability-named foreground failure messages and visible unknown fallback evidence.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Compiled-artifact integration tests for the complete matrix **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Each canonical Markdown fixture token is present and has a non-prose foreground after highlighting settles.
  - [ ] Each representative diff fixture token is present and has a non-prose foreground.
  - [ ] A default-colored or missing token error names its canonical capability and surface.
  - [ ] The unknown-label fixture remains visible plaintext and is not promoted to a highlighted capability.
- Integration tests:
  - [ ] The host compiled binary prints `SELF-CHECK OK` and every matrix token.
  - [ ] The host compiled binary fails non-zero when injected foreground evidence is absent.
  - [ ] Existing `--version`, `--help`, worker extraction, and temporary-artifact cleanup checks remain green.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Source and compiled artifacts prove the same declared capability set.
- Release failures identify the missing capability without exposing source content.
