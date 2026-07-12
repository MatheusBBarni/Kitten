---
status: completed
title: "Idle-screen welcome banner"
type: frontend
complexity: medium
dependencies:
    - task_02
    - task_03
---

# Task 06: Idle-screen welcome banner

## Overview
Replace the bare empty-state one-liner with the welcome banner on the idle screen, so a launched-and-ready cockpit greets the user, names both agents, and teaches the hand-off.
The banner uses the quiet variant after the first run and yields to the transcript as soon as a conversation starts.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST render the `WelcomeBanner` in the conversation empty-state (`turns.length === 0`) in place of `EMPTY_TRANSCRIPT_HINT`.
- MUST select the `full`/`quiet` variant from `welcomeBanner` + first-run state (task_02).
- MUST pass the ready agents and cwd, and include the hand-off on-ramp.
- MUST render the transcript (banner gone) once the conversation has any turns.
- MUST preserve the not-ready focused-agent path (the `NotReadyNotice` still shows).
- MUST fall back to the one-line greeting on narrow width, consistent with the banner component.
</requirements>

## Subtasks
- [ ] 6.1 Wire the banner into the empty-state return in `ConversationView` (and/or the `CockpitApp` fallback).
- [ ] 6.2 Compute the variant from config + first-run state and pass agents + cwd.
- [ ] 6.3 Keep the not-ready notice and the non-empty transcript paths intact.
- [ ] 6.4 Add tests for the empty, non-empty, quiet, and not-ready states.

## Implementation Details
Modify `src/ui/ConversationView.tsx` (the `turns.length === 0` block) and, if needed, `src/ui/CockpitApp.tsx` (the empty-state fallback and not-ready branch).
Consume `WelcomeBanner` (task_03) and `bannerVariant` (task_02).
See ADR-003 and ADR-005, and the TechSpec "User Experience".

### Relevant Files
- `src/ui/ConversationView.tsx` — `EMPTY_TRANSCRIPT_HINT` empty-state block.
- `src/ui/CockpitApp.tsx` — conversation-region body and not-ready branch.
- `src/ui/WelcomeBanner.tsx` — the banner (task_03).
- `src/config/appState.ts` — variant decision (task_02).

### Dependent Files
- None; the change is confined to the empty-state rendering.

### Related ADRs
- [ADR-003: Boot Banner via a Transient Pre-Controller Render Root](adrs/adr-003.md) — Idle screen shares the banner component.
- [ADR-005: First-Run Persistence via a Runtime State File plus a Read-Only Config Setting](adrs/adr-005.md) — Quiet-after-first-run behavior.

## Deliverables
- Welcome banner on the idle empty-state, replacing the muted one-liner.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test: empty transcript shows the banner; a first turn replaces it **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] An empty transcript renders the banner (both agents "ready", cwd shown) instead of `EMPTY_TRANSCRIPT_HINT`.
  - [ ] After first run (marker set), the empty state renders the quiet variant.
  - [ ] The banner copy names the hand-off on-ramp.
  - [ ] A not-ready focused agent still renders `NotReadyNotice`, not the banner.
- Integration tests:
  - [ ] With zero turns the banner shows; after a user turn is added, the transcript renders and the banner is gone.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The idle screen names the second agent and the hand-off (closing the onboarding gap)
- Existing transcript and not-ready behavior are unchanged
