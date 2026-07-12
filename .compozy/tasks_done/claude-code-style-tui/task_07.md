---
status: completed
title: "Git branch reader utility"
type: backend
complexity: low
dependencies: []
---

# Task 07: Git branch reader utility

## Overview
Add a small, fail-soft utility that reads the current git branch for a given working directory off the render path.
It is the one net-new data source this reskin owns, and it degrades cleanly to a short SHA for a detached HEAD and to nothing outside a repository.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `src/config/gitBranch.ts` exposing an async reader that, given a `cwd`, returns a branch, a short SHA (detached HEAD), or a null/absent result.
- MUST use `Bun.spawn` with the `cwd` option, mirroring the transport spawn conventions.
- MUST return the null/absent result on a non-repo directory, a non-zero exit, or a spawn error — fail-soft, never throwing.
- MUST accept an injectable spawn seam so tests do not shell out.
- MUST NOT be invoked on the render path (callers hook it at boundaries in task_09).
</requirements>

## Subtasks
- [ ] 7.1 Implement the async branch read with `Bun.spawn` + `cwd`.
- [ ] 7.2 Add the detached-HEAD short-SHA fallback.
- [ ] 7.3 Make every failure path return the null/absent result.
- [ ] 7.4 Add the injectable spawn seam.
- [ ] 7.5 Add unit tests for branch, detached, non-repo, and failure cases.

## Implementation Details
Create `src/config/gitBranch.ts` and `src/config/gitBranch.test.ts`.
Mirror the `Bun.spawn` usage in `src/agent/transport.ts` (env spread, `proc.exited` exit-code check) and collect stdout to a string.
See ADR-007 and the TechSpec "Integration Points" (Git).

### Relevant Files
- `src/agent/transport.ts` — the `Bun.spawn` precedent to mirror.
- `src/config/configLoader.ts` — injectable-seam and env-option convention.

### Dependent Files
- `src/app/controller.ts` / `src/core/sessionReducer.ts` (task_09) — invoke the reader and store the result.

### Related ADRs
- [ADR-007: Git Branch via Boot plus Turn-Boundary Refresh](adrs/adr-007.md) — This task provides the reader; task_09 provides the refresh cadence.

## Deliverables
- `src/config/gitBranch.ts` fail-soft branch reader with an injectable spawn seam.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test: reader returns the real branch in a temporary git repo **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] In a repo on branch `main`, the reader returns `main` (temp git dir or injected spawn output).
  - [ ] On a detached HEAD, the reader returns a short SHA rather than a branch name.
  - [ ] In a non-repo directory, the reader returns the null/absent result.
  - [ ] A non-zero git exit returns the null/absent result.
  - [ ] An injected spawn that throws returns the null/absent result (no throw escapes).
- Integration tests:
  - [ ] Against a real `mkdtemp` git repo, the reader reports the checked-out branch.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The reader never throws and never runs on the render path
- Detached HEAD and non-repo cases degrade cleanly
