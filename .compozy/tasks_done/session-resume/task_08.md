---
status: completed
title: "Resume-last-run startup fast-path"
type: backend
complexity: medium
dependencies:
    - task_02
    - task_07
---

# Task 08: Resume-last-run startup fast-path

## Overview
The most common resume is "pick up where I left off," so startup should offer the project's newest run without opening the picker.
This wires the boot path to load the newest persisted run for the current project and restore it, falling back to a fresh cockpit when none exists.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST, at boot, query the run store for the newest run of the current `cwd` and restore it via the controller restore entry when one exists.
- MUST start a fresh cockpit (the existing behavior) when persistence is disabled or no run exists for the project.
- MUST choose the newest run by `updatedAt`.
- MUST surface a visible indicator that a run was resumed and keep a clear path to start a new run instead.
- MUST NOT change behavior for projects that have no prior run.

## Subtasks
- [ ] 8.1 Query the newest run for the current project at boot
- [ ] 8.2 Branch between restore and fresh start
- [ ] 8.3 Show a resumed-run indicator and a start-new-run path
- [ ] 8.4 Cover the restore, fresh, and newest-selection cases in tests

## Implementation Details
Modify `src/index.ts` (`createCockpitSession`/`main` boot chain) to consult the run store (task_02) and call the controller restore entry (task_07) when a newest run exists.
See the TechSpec "Development Sequencing" step 5; the prompt-vs-silent detail is an open question noted below.

### Relevant Files
- `src/index.ts` — the boot chain (`createCockpitSession`, `main`, `renderCockpit`)
- `src/persistence/runStore.ts` — `list`/`load` to find the newest run (task_02)
- `src/app/controller.ts` — the restore entry point (task_07)

### Dependent Files
- `test/cockpitSession.test.ts` — boot wiring
- `test/index.integration.test.tsx` — end-to-end boot

### Related ADRs
- [ADR-002: V1 Rollout Shape](../adrs/adr-002.md) — "resume last run" fast-path alongside the picker
- [ADR-004: Live Restore via loadSession Replay](../adrs/adr-004.md) — restore mechanics

## Deliverables
- Boot-time resume of the newest run for the project, with a fresh-start fallback
- A resumed-run indicator and a start-new-run path
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test that boot resumes a persisted run end-to-end **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] boot with a newest run present invokes restore with that record
  - [ ] boot with no runs for the project starts fresh sessions (existing behavior unchanged)
  - [ ] boot with persistence disabled starts fresh even if run files exist
  - [ ] the newest run is chosen by `updatedAt` when several exist
- Integration tests:
  - [ ] end-to-end boot (fake agents) resumes a persisted run and the cockpit shows restored state
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Returning to a project resumes the newest run without opening the picker
- Projects with no prior run keep the existing fresh-start behavior

## Open Questions
- Whether to resume silently with an easy "start new" path or prompt once on startup (PRD Open Questions); implement silent resume with a visible indicator unless the reviewer directs otherwise.
