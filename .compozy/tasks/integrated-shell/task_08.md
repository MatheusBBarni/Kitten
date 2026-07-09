---
status: pending
title: "ShellPane render bridge"
type: frontend
complexity: high
dependencies:
  - task_02
  - task_05
---

# Task 08: ShellPane render bridge

## Overview
Render the shell inside the cockpit.
`ShellPane` reads the emulator's active screen buffer through the controller-owned runtime and paints it into OpenTUI as styled runs, re-rendering only when the shell's `renderRev` changes, so a busy shell never repaints the rest of the cockpit.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST implement `src/ui/ShellPane.tsx` that renders the runtime's `view()` styled runs into OpenTUI, mounted in the cockpit's main region.
- MUST subscribe to `selectShell` (or its `renderRev`) so a render happens only when the screen changes, following the `useAppSelector`/`useSyncExternalStore` pattern.
- MUST render full-color output (foreground/background/attributes) faithfully from the styled runs.
- MUST provide a scrollback view of the bounded buffer within the pane region.
- MUST size the pane from live terminal dimensions and reflow on resize (calling the runtime `resize`).
- SHOULD reuse the `<scrollbox>` conventions from `ConversationView` for the scrollable region.

## Subtasks
- [ ] 8.1 Build `ShellPane` reading `view()` and painting styled runs
- [ ] 8.2 Subscribe to `renderRev` so re-renders are minimal
- [ ] 8.3 Render color and attributes from the styled runs
- [ ] 8.4 Provide scrollback within the pane
- [ ] 8.5 Reflow on resize by calling the runtime `resize`

## Implementation Details
Create `src/ui/ShellPane.tsx`; expose the runtime to it via `src/ui/cockpitContext.tsx`. Follow `src/ui/ConversationView.tsx` for the scrollbox pattern and `src/ui/CockpitApp.tsx` for terminal-dimension sizing. See TechSpec "System Architecture" (data flow) for the render path. Mounting/focus toggling is task_09.

### Relevant Files
- `src/ui/ConversationView.tsx` — `<scrollbox>` pattern and the OpenTUI 0.4.3 sticky-scroll quirk to respect
- `src/ui/CockpitApp.tsx` — `useTerminalDimensions` sizing and the main region
- `src/ui/cockpitContext.tsx` — how views obtain the controller
- `src/ui/theme.ts` — palette usage for styled output

### Dependent Files
- `src/ui/CockpitApp.tsx` — mounts `ShellPane` in the toggled region (task_09)

### Related ADRs
- [ADR-003: Shell Runtime and Rendering Architecture](adrs/adr-003.md) — render state stays imperative, only `renderRev` crosses the store
- [ADR-005: In-Pane Interactive Apps, Pane Focus, and Ctrl+C Routing](adrs/adr-005.md) — the pane hosts in-pane rendering

## Deliverables
- `src/ui/ShellPane.tsx` rendering the active buffer with color and scrollback
- Runtime exposed through the cockpit context
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for render-on-change **(REQUIRED)**

## Tests
- Unit tests (test renderer + mock runtime):
  - [ ] a `view()` with a red-foreground run renders a span with the expected color
  - [ ] a `renderRev` bump triggers exactly one re-render; an unrelated agent update triggers none
  - [ ] output longer than the pane height is scrollable within the pane
  - [ ] a terminal resize calls the runtime `resize` with the new pane dimensions
- Integration tests:
  - [ ] driving the in-memory runtime with multi-line colored output paints the expected frame snapshot
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The shell renders with faithful color and navigable scrollback
- A busy shell does not repaint the agent conversation
