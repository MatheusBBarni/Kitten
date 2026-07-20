---
status: completed
title: Direct-Argv External Editor Launcher
type: backend
complexity: medium
---

# Task 3: Direct-Argv External Editor Launcher

## Overview

Provide a controller-injected launcher that opens a prevalidated file with a system default or explicitly configured editor. The boundary must preserve direct argv semantics, a single safe fallback, and closed outcomes suitable for UI and telemetry.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- The launcher MUST use direct executable-plus-argv spawning and MUST NOT invoke a shell.
- A custom preference MUST contain exactly one full `{file}` placeholder; malformed preferences MUST resolve to a safe fixed outcome.
- Custom launch failure MUST attempt the system-default launcher exactly once and report the final closed outcome.
- The launcher MUST accept only a prevalidated regular file path and MUST not perform repository discovery.
</requirements>

## Subtasks

- [ ] 3.1 Define the editor preference, launcher interface, and closed outcome vocabulary.
- [ ] 3.2 Implement platform default launch commands through an injected process seam.
- [ ] 3.3 Implement strict custom executable and argument-vector expansion.
- [ ] 3.4 Implement single custom-to-default fallback behavior.
- [ ] 3.5 Add exact argv, fallback, malformed-preference, and unsupported-platform tests.

## Implementation Details

Follow the TechSpec “Core Interfaces,” “File Open Algorithm,” and “Failure Semantics” sections. Keep direct command construction and spawn behavior inside the launcher so actions only handle the resulting closed outcome.

### Relevant Files

- `src/app/controller.ts` — existing injectable capability pattern and production ownership seam.
- `src/app/actions.ts` — will call the launcher after source revalidation.
- `src/app/managedWorktree.ts` — repository convention for injected process boundaries and result handling.

### Dependent Files

- `src/app/externalEditor.ts` — new direct-argv launcher implementation.
- `src/app/externalEditor.test.ts` — new process-seam and fallback test coverage.
- `src/config/configLoader.ts` — will validate and load the preference model.

### Related ADRs

- [ADR-003: Keep explorer I/O behind separate controller-owned capabilities](adrs/adr-003.md) — keeps process I/O out of the view layer.
- [ADR-004: Persist editor preferences as validated direct argument vectors](adrs/adr-004.md) — defines strict placeholder and fallback behavior.

## Deliverables

- Injectable external editor launcher with system-default and custom preference support.
- Closed launch outcomes and a one-time fallback guarantee.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for action-facing launch outcomes **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Default launch uses the exact supported-platform argv and never a shell command.
  - [ ] Custom launch substitutes exactly one full `{file}` token into direct argv.
  - [ ] Missing, partial, or repeated placeholders are rejected without spawning a custom command.
  - [ ] Custom success emits its successful closed outcome without fallback.
  - [ ] Custom failure attempts one default launch; final default failure and unsupported platform remain distinguishable.
- Integration tests:
  - [ ] A prevalidated file reaches the injected launcher with no workspace discovery side effects.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- No launch path uses a shell or interpolated command string.
- Every launch settles in a fixed, UI-safe outcome.
