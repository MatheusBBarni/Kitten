---
status: completed
title: "UI shell, cockpit, and status strip"
type: frontend
complexity: medium
dependencies:
  - task_05
  - task_07
---

# Task 08: UI shell, cockpit, and status strip

## Overview
Build the terminal shell that boots the renderer and lays out the focused-pane cockpit with a status strip showing both agents' state and a global keymap for focus switching.
This is the frame every other view mounts into, and it must render cleanly on resize and adapt to the terminal theme.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST boot the OpenTUI renderer and mount a React root per the `@opentui/react` pattern (ADR-004).
- MUST render a focused-pane layout: one full-width conversation region plus a persistent `StatusStrip`.
- MUST show each agent's state (idle / working / awaiting approval / not-ready) in the `StatusStrip` from store selectors.
- MUST bind a keymap that switches the focused agent via the controller's `switchFocus`, and expose a discoverable help affordance.
- MUST handle terminal resize and theme (dark/light) without garbling the layout.
- MUST subscribe through narrow selectors so status updates do not re-render unrelated regions (ADR-004).
</requirements>

## Subtasks
- [x] 8.1 Boot the renderer and mount the React root
- [x] 8.2 Lay out the focused conversation region and persistent status strip
- [x] 8.3 Render per-agent status from store selectors
- [x] 8.4 Bind the focus-switch keymap and a help affordance
- [x] 8.5 Handle resize and theme changes cleanly
- [x] 8.6 Add `testRender` snapshots for the shell and status states

## Implementation Details
Create the shell and status strip. See TechSpec "System Architecture → UI Shell" and the UX section of the PRD (focused pane + quick switch, keyboard-first, flicker-free). Use `useKeyboard`/`useOnResize` from `@opentui/react`. Focus switching calls the controller action from task_07.

### Relevant Files
- `src/ui/main.tsx` — new; renderer bootstrap and root mount
- `src/ui/CockpitApp.tsx` — new; top-level layout
- `src/ui/StatusStrip.tsx` — new; per-agent status display
- `src/ui/keymap.ts` — new; global keybindings
- `src/ui/CockpitApp.test.tsx` — new; `testRender` snapshots

### Dependent Files
- `src/ui/ConversationView.tsx` (task_09) — mounts in the conversation region
- `src/ui/PromptEditor.tsx` (task_10) — mounts under the conversation region
- `src/ui/ApprovalPrompt.tsx` (task_11), `src/ui/HandoffPreview.tsx` (task_12) — overlays mounted by the shell

### Related ADRs
- [ADR-004: React Binding for the OpenTUI UI Layer](adrs/adr-004.md) — bootstrap pattern, narrow subscriptions, overlays without Portal

## Deliverables
- Bootable cockpit shell with a status strip and focus switching
- Unit tests with 80%+ coverage **(REQUIRED)**
- `testRender` snapshot/integration tests for the shell **(REQUIRED)**

## Tests
- Unit tests:
  - [x] The status strip shows `working` for an agent whose store status is working and `idle` for the other
  - [x] A not-ready agent renders a distinct not-ready indicator in the strip
  - [x] The focus-switch keybinding invokes the controller's `switchFocus`
  - [x] Toggling the help affordance shows and hides the help content
- Integration tests:
  - [x] `testRender` snapshot of the cockpit at a fixed size matches the expected frame
  - [x] A simulated resize re-lays out the frame without overflow artifacts
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The shell boots, renders the focused pane plus status strip, and switches focus by keybinding
- Layout survives resize and adapts to the terminal theme
