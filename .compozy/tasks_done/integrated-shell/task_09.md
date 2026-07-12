---
status: completed
title: "Pane focus, toggle chord, input forwarding, and Ctrl+C routing"
type: frontend
complexity: high
dependencies:
    - task_02
    - task_07
    - task_08
    - task_11
---

# Task 09: Pane focus, toggle chord, input forwarding, and Ctrl+C routing

## Overview
Make the shell interactive and safe to focus.
Add a toggle chord that swaps the main region between the focused agent and the full-width shell, forward keystrokes to the PTY while the shell is focused, stand the global chords down, and route `Ctrl+C` to the foreground command instead of quitting the app.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a `toggle-shell` command to `COCKPIT_KEYMAP` (VS Code convention `Ctrl+` `` ` ``, with a documented fallback) that shows/focuses the shell and returns focus to the agent.
- MUST render `ShellPane` in the main region when the shell is focused and the agent conversation otherwise.
- MUST forward key events to the runtime via the task_07 encoder while the shell is focused, and stand the global cockpit chords down except the toggle chord and the interrupt.
- MUST set `exitOnCtrlC: false` on the renderer and route `Ctrl+C`: shell-focused forwards `0x03` to the PTY (never quits); otherwise the existing app-quit teardown runs.
- MUST record `shell_activated` on first shell command use via the recorder (task_11).
- SHOULD indicate focus clearly so the user always knows whether the agent or the shell owns the keyboard.

## Subtasks
- [ ] 9.1 Add the `toggle-shell` chord and mount `ShellPane` by focused pane
- [ ] 9.2 Forward encoded keys to the runtime while the shell is focused
- [ ] 9.3 Stand global chords down when the shell is focused, keeping the toggle
- [ ] 9.4 Flip `exitOnCtrlC` off and route `Ctrl+C` by focus
- [ ] 9.5 Emit `shell_activated` on first command use and show a focus indicator

## Implementation Details
Modify `src/ui/CockpitApp.tsx` (keyboard routing, main-region mounting), `src/ui/keymap.ts` (the chord + `SHELL_HINT`), and `src/index.ts` (`exitOnCtrlC`, and preserving the agent-focused quit path). See TechSpec "System Architecture" (input routing) and ADR-005. Focus state and setters come from task_02; the encoder from task_07; the pane from task_08.

### Relevant Files
- `src/ui/CockpitApp.tsx` — `useKeyboard`, `matchCommand`, overlay stand-down precedence, main-region render
- `src/ui/keymap.ts` — `COCKPIT_KEYMAP`, `matchCommand`, hints
- `src/index.ts` — `createCockpitRenderer` `exitOnCtrlC` and the Ctrl+C teardown wiring
- `src/store/selectors.ts` — `selectFocusedPane`/`selectIsShellFocused` (task_02)

### Dependent Files
- `src/ui/ShellPane.tsx` — receives focus and forwarded input (task_08)
- `src/ui/StatusStrip.tsx` — reflects the new chord in the hint (task_14)

### Related ADRs
- [ADR-005: In-Pane Interactive Apps, Pane Focus, and Ctrl+C Routing](adrs/adr-005.md) — focus union, input routing, and Ctrl+C semantics

## Deliverables
- Toggle chord, pane mounting by focus, input forwarding, and Ctrl+C routing
- `exitOnCtrlC: false` with the agent-focused quit path preserved
- `shell_activated` telemetry on first use
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for focus and interrupt **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] the toggle chord flips `focusedPane` between agent and shell
  - [ ] while the shell is focused, a printable key is forwarded to the runtime `write`; while the agent is focused it is not
  - [ ] while the shell is focused, `Ctrl+O`/`Ctrl+T`/`F1` do not fire their cockpit commands
  - [ ] shell-focused `Ctrl+C` forwards `0x03` and does not trigger app teardown
  - [ ] agent-focused `Ctrl+C` runs the existing teardown path
  - [ ] first shell command use records `shell_activated` once
- Integration tests:
  - [ ] toggling into the shell, typing a command, and toggling back leaves the agent conversation intact
  - [ ] a runaway command interrupted with `Ctrl+C` stops without the app exiting
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Keystrokes reach the shell only when it is focused; `Ctrl+C` never quits from the shell
- The agent-focused quit path still works
