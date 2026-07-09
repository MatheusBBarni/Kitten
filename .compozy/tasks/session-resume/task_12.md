---
status: pending
title: "Restoration degradation UX"
type: frontend
complexity: medium
dependencies:
  - task_06
  - task_07
---

# Task 12: Restoration degradation UX

## Overview
A resume can bring one pane back live and leave the other unavailable, and the user must see that honestly rather than face a silently empty pane.
This renders a per-pane restoration badge and, for an unavailable pane, shows the persisted hand-off bundle as context with a "start fresh from this context" action.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST render a per-pane badge driven by `selectRestoration(agentId)`: unobtrusive for `"live"`, a visible "history unavailable" label for `"unavailable"`.
- For an `"unavailable"` pane, MUST show the persisted hand-off bundle summary as read context when a bundle exists.
- MUST offer a "start fresh from this context" action that seeds a new session for that agent from the bundle (composed prompt blocks) and sends it as the first message.
- MUST leave a normal run (restoration `null`) rendering unchanged.
- MUST NOT fabricate transcript history for an unavailable pane.

## Subtasks
- [ ] 12.1 Render the per-pane restoration badge from the selector
- [ ] 12.2 Show the persisted bundle summary for an unavailable pane
- [ ] 12.3 Add the "start fresh from this context" action seeding from the bundle
- [ ] 12.4 Leave normal (null) restoration rendering unchanged
- [ ] 12.5 Cover live, unavailable, start-fresh, and null cases in tests

## Implementation Details
Modify `src/ui/ConversationView.tsx` and/or `src/ui/StatusStrip.tsx` to read `selectRestoration` (task_06) and render the badge and unavailable-pane context.
Compose the seed prompt from the bundle using the existing hand-off block composition (`composeHandoffBlocks` in `src/app/handoff.ts`) and send via the controller actions; restoration status is set by task_07.
See the TechSpec "Core Features" (Graceful unavailability) and ADR-004/ADR-001.

### Relevant Files
- `src/ui/ConversationView.tsx` — the pane that renders a session's turns
- `src/ui/StatusStrip.tsx` — per-agent status display
- `src/store/selectors.ts` — `selectRestoration` (task_06)
- `src/app/handoff.ts` — `composeHandoffBlocks` for seeding from the bundle
- `src/app/actions.ts` — `sendPrompt` to send the seed

### Dependent Files
- `src/app/controller.ts` — sets `restoration` during restore (task_07)
- `src/ui/ConversationView.test.tsx`, `src/ui/StatusStrip.test.tsx` — extend for the badge and start-fresh

### Related ADRs
- [ADR-004: Live Restore via loadSession Replay](../adrs/adr-004.md) — two-state degradation, unavailable pane shows the bundle
- [ADR-001: Two-Layer Whole-Cockpit Resume](../adrs/adr-001.md) — honest per-side status

## Deliverables
- A per-pane restoration badge and an unavailable-pane context view
- A "start fresh from this context" action seeding from the bundle
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test that an unavailable pane offers start-fresh and seeds the agent **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] restoration `"live"` renders no "history unavailable" label
  - [ ] restoration `"unavailable"` renders the label and, when a bundle exists, its summary
  - [ ] "start fresh from this context" composes prompt blocks from the bundle and sends them to that agent
  - [ ] a pane with `null` restoration (normal run) renders unchanged
  - [ ] an unavailable pane with no bundle shows the label without fabricating history
- Integration tests:
  - [ ] a restored run with one unavailable pane offers start-fresh and, on invocation, seeds that agent from the bundle
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Each pane honestly shows live vs unavailable; an unavailable pane offers a bundle-seeded fresh start
- Normal runs are visually unchanged
