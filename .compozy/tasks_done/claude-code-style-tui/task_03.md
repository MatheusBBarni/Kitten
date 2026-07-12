---
status: completed
title: "WelcomeBanner component"
type: frontend
complexity: medium
dependencies:
    - task_01
---

# Task 03: WelcomeBanner component

## Overview
Build the shared, prop-driven welcome banner: a deterministic ANSI-safe kitten mascot, a greeting, per-agent connection rows, the working directory, and the hand-off on-ramp.
It is a pure presentation leaf that holds no store state and is rendered by both the boot root (task_05) and the idle screen (task_06), with a `full` and a `quiet` variant.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST create `src/ui/WelcomeBanner.tsx` accepting `WelcomeBannerProps` (`variant`, `agents[]`, `cwd`) per the TechSpec "Core Interfaces" section.
- MUST render a deterministic, ANSI-safe character-cell kitten mascot (no image protocol), with a one-line greeting fallback under narrow width or limited terminal capability.
- MUST render the `full` variant with mascot, greeting, one row per agent showing `connecting` / `ready` / `unavailable`, the cwd, and the hand-off on-ramp copy.
- MUST render the `quiet` variant as a single branded greeting line only.
- MUST read every color from `usePalette()` (task_01 keys) and use a rounded border where bordered.
- MUST hold zero session or store state (all inputs arrive as props).
</requirements>

## Subtasks
- [ ] 3.1 Define `WelcomeBannerProps` and the component skeleton.
- [ ] 3.2 Author the ANSI-safe mascot cell-art and its narrow-width one-line fallback.
- [ ] 3.3 Lay out the `full` variant (mascot, greeting, agent rows, cwd, on-ramp).
- [ ] 3.4 Implement the `quiet` one-line variant.
- [ ] 3.5 Add unit tests for both variants and the fallback.

## Implementation Details
Create `src/ui/WelcomeBanner.tsx` and `src/ui/WelcomeBanner.test.tsx`.
Use OpenTUI `<box>` (`borderStyle: "rounded"`), `<text>`/`<span>`, and flexbox, reading colors from `theme.ts` (task_01).
See ADR-003 and ADR-001, and the TechSpec "System Architecture" (WelcomeBanner) and "Core Interfaces".

### Relevant Files
- `src/ui/theme.ts` — palette keys (accent, banner tones) added in task_01.
- `src/ui/StatusStrip.tsx` — reference for OpenTUI text/span/color usage.
- `src/ui/CockpitApp.tsx` — reference for bordered-box layout conventions.

### Dependent Files
- `src/index.ts` (task_05) — renders the banner as the transient boot root.
- `src/ui/ConversationView.tsx` (task_06) — renders the banner in the idle empty-state.

### Related ADRs
- [ADR-003: Boot Banner via a Transient Pre-Controller Render Root](adrs/adr-003.md) — Shared banner used by boot and idle screens.
- [ADR-001: V1 Scope for the Claude Code-Style TUI Reskin](adrs/adr-001.md) — Simple deterministic mascot; elaborate/animated deferred.

## Deliverables
- `src/ui/WelcomeBanner.tsx` with `full` and `quiet` variants and a mascot fallback.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test: banner renders correctly under light and dark palettes **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `full` variant renders the mascot, greeting, both agent rows, the cwd, and the hand-off on-ramp text.
  - [ ] `quiet` variant renders only the one-line greeting (no mascot, no agent rows).
  - [ ] An agent row shows "connecting", "ready", or "unavailable" matching its `state`.
  - [ ] At a width below the mascot threshold, the banner falls back to the one-line greeting.
- Integration tests:
  - [ ] Mounted via `testRender` under dark and then light (`theme_mode` flip), the banner stays legible and repaints its accent.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Both variants render legibly in dark, light, and no-truecolor terminals
- The component reads all state from props and holds no store dependency
