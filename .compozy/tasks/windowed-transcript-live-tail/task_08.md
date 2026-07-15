---
status: pending
title: Render the Projected Conversation and Preserve Anchors
type: frontend
complexity: high
---

# Task 08: Render the Projected Conversation and Preserve Anchors

## Overview

Integrate the enabled projection into ConversationView without changing semantic transcript ownership or degraded restoration behavior. Render a focusable counted marker, preserve protected live content and stable row identities, and maintain each detached reader's visual position through streams, reveals, and focus switches.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST consume task 02's focused projection selector; disabled mode MUST retain the current full transcript rendering with no marker.
2. MUST render turn and marker rows by supplied stable row keys, never by projected array index.
3. MUST render exactly one keyboard-focusable counted history marker when hidden history exists and route activation to task 02's session-scoped reveal action.
4. MUST keep streaming, pending/in-progress, approval-owned, and recent protected content visible without inventing clarification-owned transcript context.
5. MUST preserve detached anchors across stream and prepend changes, restore per-session reading state only on that session's live focus, and return to bottom on return-to-live.
6. MUST leave unavailable-restoration rendering, sticky behavior, and the horizontal-scrollbar workaround intact.
</requirements>

## Subtasks

- [ ] Replace direct focused-turn mapping with task 02 projection consumption.
- [ ] Render stable turn rows and the one counted, focusable marker.
- [ ] Route marker reveal and return-to-live state through session-scoped store actions.
- [ ] Capture and restore scrollbox position around projection changes and focus transitions.
- [ ] Preserve disabled, protected-content, and unavailable-restoration behavior.
- [ ] Add real-renderer regression coverage for bounds, identity, anchors, and session isolation.

## Implementation Details

Modify src/ui/ConversationView.tsx and src/ui/ConversationView.test.tsx only. Follow the TechSpec System Architecture, Integration Points, and Testing Approach sections. Use the existing CONVERSATION_SCROLLBOX_ID and supported ScrollBox APIs; do not add a component, virtualizer, reducer change, command registration, config change, or telemetry emission.

### Relevant Files

- src/ui/ConversationView.tsx — projection rendering, marker, and renderer-owned scroll anchoring.
- src/ui/ConversationView.test.tsx — real OpenTUI scrollbox and transcript regression seam.

### Dependent Files

- src/store/selectors.ts — task 02 projection selector.
- src/store/appStore.ts — task 02 reveal/anchor/return actions.
- src/core/transcriptProjection.ts — task 01 stable row contract.
- src/ui/keymap.ts — task 09 exposes slash commands separately.
- src/telemetry/recorder.ts — task 10 observes approved changes later.

### Related ADRs

- [ADR-001: Ship a flagged bounded live transcript projection](adrs/adr-001.md) — Defines protected live content.
- [ADR-002: Launch bounded live history as a truth-first experiment](adrs/adr-002.md) — Defines counted reveal and detached reading behavior.
- [ADR-003: Separate transcript projection from semantic session state](adrs/adr-003.md) — Assigns renderer scroll ownership here.
- [ADR-004: Use strict config, canonical commands, and bounded evidence](adrs/adr-004.md) — Defines marker-based discovery without a global chord.

## Deliverables

- Projection-aware conversation renderer and focusable counted marker.
- Session-isolated scroll anchoring and disabled/restoration boundary preservation.
- Real-renderer projection, anchor, and session-switch tests.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Conversation integration tests **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Enabled 1,000-turn fixture renders at most 120 transcript rows including the marker and retains the recent tail sentinel.
  - [ ] Disabled fixture renders its full small transcript with no marker.
  - [ ] Marker activation reveals an earlier batch, reduces hidden count deterministically, and retains the recent tail.
  - [ ] Streamed tail updates preserve frozen row identity and update the existing message row.
  - [ ] Historical pending/in-progress/approval tools remain visible; completion permits deterministic collapse.
- Integration tests:
  - [ ] Manual scrollbox detachment plus stream does not jump to bottom.
  - [ ] Prepending history preserves the visual anchor and return-to-live scrolls to bottom.
  - [ ] Two focused sessions retain independent depth and anchors after focus switching.
  - [ ] Unavailable restoration never renders marker or fabricated transcript content.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Rendered rows stay bounded while all live-run turns remain available to the projection.
- Detached readers keep their position through all supported updates.
