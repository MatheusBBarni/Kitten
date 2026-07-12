---
status: completed
title: "Branch event, reducer, and refresh wiring"
type: backend
complexity: medium
dependencies:
    - task_07
    - task_08
---

# Task 09: Branch event, reducer, and refresh wiring

## Overview
Populate `SessionState.branch` from the git reader by adding a `branch` domain event and reducer case, and invoking the reader off the render path at boot and at focus/turn boundaries.
This makes the branch segment in the status bar real and keeps it current across between-task branch changes.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a `{ kind: "branch"; branch: string }` arm to `DomainSessionEvent` and a matching reducer `case "branch"` that replaces only the branch field, keeping the `assertNever` guard compiling.
- MUST invoke the git reader (task_07) per session `cwd` at boot and refresh at focus switch and turn completion, off the render path.
- MUST dispatch a `branch` event to update the store when a branch is read.
- MUST leave the branch hidden (no/blank event) when the reader returns the null/absent result.
- MUST run the reader asynchronously and never block the UI on it.
</requirements>

## Subtasks
- [ ] 9.1 Add the `branch` event arm and the reducer case (mirroring `case "status"`).
- [ ] 9.2 Read the branch per session `cwd` at boot and dispatch it.
- [ ] 9.3 Refresh the branch on focus switch and on turn completion.
- [ ] 9.4 Keep the segment hidden when the reader returns null.
- [ ] 9.5 Add reducer and wiring tests.

## Implementation Details
Modify `src/core/types.ts` (`DomainSessionEvent`), `src/core/sessionReducer.ts` (the `case "branch"`), and the boot/boundary hooks in `src/app/controller.ts` (and/or `src/app/actions.ts` for focus/turn boundaries).
Reuse the reader from task_07 and the `branch` field/selector from task_08.
See ADR-007 and the TechSpec "System Architecture" (Branch reader) and "Development Sequencing".

### Relevant Files
- `src/core/sessionReducer.ts` — event `switch` + `assertNever`; mirror `case "status"`.
- `src/core/types.ts` — `DomainSessionEvent` union.
- `src/app/controller.ts` — boot per-session lifecycle; branch read on start.
- `src/app/actions.ts` — focus switch; a turn-completion boundary.
- `src/config/gitBranch.ts` — the reader (task_07).

### Dependent Files
- `src/ui/StatusStrip.tsx` (task_11) — renders the branch via `selectSessionBranch`.

### Related ADRs
- [ADR-007: Git Branch via Boot plus Turn-Boundary Refresh](adrs/adr-007.md) — This task's refresh cadence.

## Deliverables
- `branch` domain event + reducer case; boot + focus/turn refresh wiring.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test: focus switch triggers a branch re-read and store update **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] The reducer `case "branch"` sets `branch` and leaves `turns`, `status`, and derived fields untouched.
  - [ ] At boot, the branch is read per session `cwd` (injected reader) and a `branch` event is dispatched.
  - [ ] A focus switch triggers a refresh; a turn completion triggers a refresh.
  - [ ] When the reader returns the null/absent result, no non-empty branch is written (segment stays hidden).
- Integration tests:
  - [ ] Switching focus re-reads the branch and the store reflects the new value (injected reader returning a changed branch).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The branch is never read on the render path
- A between-task branch change is reflected by the next boundary
