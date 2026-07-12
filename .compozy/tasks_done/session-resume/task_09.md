---
status: completed
title: "Ctrl+R session picker overlay"
type: frontend
complexity: high
dependencies:
    - task_02
    - task_06
    - task_07
---

# Task 09: Ctrl+R session picker overlay

## Overview
The picker is how a user finds and resumes a specific prior run.
This adds a `Ctrl+R`-triggered modal overlay that lists the current project's runs with informative rows, filters live as the user types, previews a run before committing, and restores the selected run.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST bind a new `resume-session` command to `Ctrl+R` in the cockpit keymap and dispatch it to `openSessionPicker()` from the shell key handler.
- MUST add a `SessionPicker` overlay that returns nothing when closed and, when open, lists the current project's runs from the run store.
- Each row MUST show the run's summary or last prompt, relative time since last activity, message count, and git branch.
- MUST filter the list live (fuzzy) as the user types, support arrow navigation, `Space` to preview a run without committing, `Enter` to restore the selected run, and `Esc` to cancel.
- MUST take over the keyboard while open (mirroring the existing overlays) and rely on `selectHasOpenOverlay` so the shell stands down.
- MUST register the binding in the help panel and keymap hint.

## Subtasks
- [ ] 9.1 Add the `resume-session` command, `Ctrl+R` binding, and shell dispatch
- [ ] 9.2 Build the `SessionPicker` gate and dialog mirroring `HandoffPreview`
- [ ] 9.3 List the project's runs with summary, relative time, message count, and branch
- [ ] 9.4 Add live fuzzy filtering, arrow navigation, and `Space` preview
- [ ] 9.5 Restore the selected run on `Enter` and close on `Esc`
- [ ] 9.6 Register help/hint entries and mount the overlay
- [ ] 9.7 Cover keymap, listing, filtering, preview, and restore in tests

## Implementation Details
Add `src/ui/SessionPicker.tsx`; modify `src/ui/keymap.ts` (`COCKPIT_KEYMAP`, `CockpitCommand`, hints/help) and `src/ui/CockpitApp.tsx` (dispatch case, mount).
Clone the overlay structure of `src/ui/HandoffPreview.tsx`; read runs via the run store (task_02) and restore via the controller entry (task_07); the picker slot/selectors come from task_06.
See the TechSpec "System Architecture" and "Core Interfaces" sections and ADR-004.

### Relevant Files
- `src/ui/HandoffPreview.tsx` — the overlay gate + dialog + modal-keyboard pattern to mirror
- `src/ui/keymap.ts` — `COCKPIT_KEYMAP`, `CockpitCommand`, `matchCommand`, `ctrl()`, `KEYMAP_HINT`, `HELP_ENTRIES` (`Ctrl+R` is currently free)
- `src/ui/CockpitApp.tsx` — `CockpitFrame.onKey` dispatch and overlay mounting
- `src/ui/cockpitContext.tsx` — `useController`, `useAppSelector`
- `src/persistence/runStore.ts` — `list` for the project (task_02)

### Dependent Files
- `src/store/appStore.ts` — `openSessionPicker`/`selectSessionPicker` (task_06)
- `src/app/controller.ts` — the restore entry (task_07)
- `src/ui/keymap.test.ts`, `src/ui/CockpitApp.test.tsx` — extend for the binding and dispatch

### Related ADRs
- [ADR-004: Live Restore via loadSession Replay](../adrs/adr-004.md) — the picker triggers restore of a whole run

## Deliverables
- `src/ui/SessionPicker.tsx` overlay with listing, filtering, preview, and restore
- `resume-session` bound to `Ctrl+R` with dispatch, help, and hint entries
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test opening the picker and restoring a selected run **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `matchCommand` maps `Ctrl+R` to `resume-session` and the shell dispatch calls `openSessionPicker`
  - [ ] the overlay renders nothing when the `sessionPicker` slot is closed
  - [ ] given a fake run store with three runs, rows show summary, relative time, message count, and branch
  - [ ] typing "auth" filters to the run whose prompt was "refactor the auth guard" (fuzzy match)
  - [ ] `Enter` on the selected row invokes restore with that record and closes the picker
  - [ ] `Esc` closes the picker without restoring
- Integration tests:
  - [ ] opening the picker in the shell, selecting a run, and pressing `Enter` restores the cockpit (fake agents)
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `Ctrl+R` opens a project-scoped picker with informative, filterable rows and preview
- Selecting a run restores the whole cockpit; the shell stands down while the picker is open
