---
status: completed
title: "In-pane interactive application support"
type: frontend
complexity: medium
dependencies:
    - task_08
    - task_09
---

# Task 10: In-pane interactive application support

## Overview
Let full-screen tools run inside the cockpit.
When a program switches to the alternate screen (vim, lazygit, htop), the pane renders the alternate buffer and may expand to full height, so the user never has to leave for an external terminal, keeping Kitten chrome intact.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST render the emulator's alternate-screen buffer in the pane when a program enters it (`ESC[?1049h`) and return to the primary buffer on exit (`ESC[?1049l`).
- MUST forward the full key set (including function keys and navigation) to the app while it is active, using the task_07 encoder and task_09 forwarding.
- MUST keep the cwd/env continuity of the persistent shell, since the app runs inside the same PTY.
- SHOULD expand the shell pane to full height while an alternate-screen app is active to maximize space, restoring the prior layout on exit.
- MUST ensure a resize while an app is active reflows both the PTY and the emulator so the app is not corrupted.

## Subtasks
- [ ] 10.1 Detect alternate-screen enter/exit and render the active buffer
- [ ] 10.2 Expand the pane to full height while an app is active
- [ ] 10.3 Ensure full key forwarding reaches the active app
- [ ] 10.4 Reflow correctly on resize during an app session
- [ ] 10.5 Restore the prior layout on app exit

## Implementation Details
Extend `src/ui/ShellPane.tsx` (buffer selection, full-height layout) building on task_08's rendering and task_09's input path. The emulator already tracks the active buffer; this task renders it and adjusts layout. See TechSpec "Development Sequencing" step 6 and ADR-005 for the in-pane emulation decision and its risks.

### Relevant Files
- `src/ui/ShellPane.tsx` — rendering the active (primary/alternate) buffer
- `src/ui/CockpitApp.tsx` — layout that yields full height to the pane
- `src/shell/shellRuntime.ts` — surfaces which buffer is active and handles resize

### Dependent Files
- `src/ui/StatusStrip.tsx` — may hide or adapt while an app is full-height (task_14)

### Related ADRs
- [ADR-005: In-Pane Interactive Apps, Pane Focus, and Ctrl+C Routing](adrs/adr-005.md) — in-pane alt-screen emulation over window passthrough

## Deliverables
- Alternate-screen rendering in the pane with optional full-height expansion
- Correct resize behavior during an app session
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests with a real interactive app **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] an `ESC[?1049h` in the stream switches the pane to the alternate buffer; `ESC[?1049l` returns to primary
  - [ ] the pane expands to full height on alternate-screen enter and restores on exit
  - [ ] a resize during an alternate-screen session forwards new dimensions to the runtime
- Integration tests:
  - [ ] running a small alternate-screen script renders its content in the pane and returns cleanly to the shell prompt
  - [ ] a real editor session (open, edit, quit) leaves the pane back at the shell with cwd preserved
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Interactive full-screen apps run in-pane and exit cleanly
- Shell cwd/env continuity is preserved across an app session
