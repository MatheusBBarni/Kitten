---
status: pending
title: "Render confirmed default outcomes in the status strip"
type: frontend
complexity: medium
---

# Task 8: Render confirmed default outcomes in the status strip

## Overview

Render the selected session's reducer-owned default outcome beside existing confirmed provider, model, and effort status. The status strip remains presentation-only and preserves truthful values, one-row layout, and narrow-terminal behavior.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. The strip MUST subscribe through the narrow selected-session result selector and MUST not call actions or mutate state.
- 2. Provider, model, and effort text MUST continue to come only from confirmed options.
- 3. Applied, partial-effort, and unavailable-model outcomes MUST show explicit labels; none MUST preserve legacy output.
- 4. Partial feedback MUST show post-model confirmed effort, never requested unavailable or prior effort.
- 5. At narrow widths the strip MUST retain one truthful footer row with no overflow, clipped row, or lost help behavior.
</requirements>

## Subtasks

- [ ] 8.1 Add a memoized session-scoped result subscription.
- [ ] 8.2 Render truthful full, partial, and unavailable labels.
- [ ] 8.3 Preserve confirmed provider/model/effort text.
- [ ] 8.4 Preserve one-row narrow-width behavior.
- [ ] 8.5 Cover direct strip and mounted cockpit output.

## Implementation Details

Implement TechSpec Impact Analysis and Known Risks using existing per-session memoized selector patterns. All outcome text derives from reducer-confirmed state.

### Relevant Files

- src/ui/StatusStrip.tsx — AgentStatusChip selector composition and footer rendering.
- src/ui/StatusStrip.test.tsx — direct renderer, fixed-width, and overflow tests.
- src/ui/CockpitApp.test.tsx — mounted shell resize and footer pinning.

### Dependent Files

- src/store/selectors.ts — narrow result selector.
- src/store/selectors.test.ts — stability proof.
- src/core/types.ts — terminal result contract.
- src/ui/CockpitApp.tsx — status-strip mount.

### Related ADRs

- [ADR-004: Sequence defaults from agent-confirmed model state](adrs/adr-004.md) — presentation-only confirmed feedback.

## Deliverables

- Status labels for applied, partial, and unavailable outcomes.
- Preserved confirmed provider/model/effort with no label for none.
- Direct and mounted narrow-width regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for cockpit status feedback **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Applied result shows confirmed provider/model/effort plus full-default label.
  - [ ] Partial effort shows post-model confirmed model/effort plus effort-unavailable copy.
  - [ ] Unavailable model retains prior confirmed values plus unavailable-model feedback.
  - [ ] None preserves legacy confirmed output with no misleading label.
- Integration tests:
  - [ ] At 64 columns, direct strip and mounted cockpit retain one truthful footer row.
  - [ ] Narrow output keeps help reachable with no overflow sentinel or clipped row.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Status feedback is session-scoped, truthful, and presentation-only.
- Existing narrow-width footer guarantees remain intact.
