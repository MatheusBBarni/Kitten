---
status: completed
title: "Status-strip headroom segment"
type: frontend
complexity: medium
dependencies:
  - task_04
  - task_05
---

# Task 06: Status-strip headroom segment

## Overview
Render each agent's headroom — a percent plus a short fixed-width bar, or "—" — in its status-strip chip, using the primitive selector and the pure formatter.
This is the always-on, side-by-side signal, and it requires updating the exact 80-column strip test for the added width.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a memoized `selectSessionHeadroom(sessionId)` subscription to `AgentStatusChip` and render the formatted percent plus a short fixed-width bar segment.
- MUST render `HEADROOM_UNKNOWN` for agents with no usage and for not-ready agents (never a fabricated number).
- MUST use a neutral treatment with no color verdict, reusing existing palette tokens (fill vs `muted` track); MUST NOT add a new palette key or inline a hex color (per ADR-002 and the theme's no-hardcoded-color rule).
- MUST keep the strip within the terminal width budget and update the exact 80-column strip test accordingly.
- MUST preserve per-agent re-render isolation by memoizing the curried selector on `sessionId`.
</requirements>

## Subtasks
- [x] 6.1 Add the memoized headroom selector to `AgentStatusChip`.
- [x] 6.2 Render the formatted percent plus bar segment using neutral palette tokens.
- [x] 6.3 Render the unknown marker for absent-usage and not-ready agents.
- [x] 6.4 Update the 80-column strip budget and no-overflow assertions for the new width.
- [x] 6.5 Add frame tests for known and unknown headroom rendering.

## Implementation Details
Modify `src/ui/StatusStrip.tsx`: add a third memoized selector to `AgentStatusChip` and a `<span>` segment after the status span, reusing tokens from `src/ui/theme.ts` (fill vs `muted` track).
Consumes `selectSessionHeadroom` (task_04) and `formatHeadroom` (task_05). See TechSpec "System Architecture" (UI surfaces) and "Impact Analysis" (the 80-column budget).

### Relevant Files
- `src/ui/StatusStrip.tsx` — `AgentStatusChip`, its memoized-selector pattern, and the `<span>` composition.
- `src/ui/theme.ts` — palette tokens for the neutral bar; reuse `muted` for the track, no new key.

### Dependent Files
- `src/ui/StatusStrip.test.tsx` — the exact 80-column budget assertion and new frame assertions.
- `src/ui/CockpitApp.test.tsx` — the strip snapshot may need updating.
- `src/ui/__snapshots__` — snapshot updates for the strip.

### Related ADRs
- [ADR-001: Ambient per-agent headroom gauge](../adrs/adr-001.md) — always-on placement in the strip.
- [ADR-002: Validation-gated honest MVP](../adrs/adr-002.md) — neutral, no verdict.
- [ADR-003: Headroom derivation](../adrs/adr-003.md) — memoized primitive selector for isolation.

## Deliverables
- Headroom segment (percent + short bar / unknown marker) in `AgentStatusChip`.
- Updated 80-column budget and snapshot tests.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration (frame) tests for the strip **(REQUIRED)**

## Tests
- Unit tests:
  - [x] The chip composes the focus marker, name, status, and headroom segment in order for a ready agent with usage.
- Integration tests:
  - [x] After `store.applyEvent(claudeId, { kind: "usage", used: 124000, size: 200000 })`, the strip frame shows `38%` and a partially-filled bar on Claude's chip.
  - [x] A Codex agent with no usage shows `—` (HEADROOM_UNKNOWN) in its chip.
  - [x] A not-ready agent shows `—`, not a number.
  - [x] With both chips populated, the strip stays within the updated 80-column budget and `expectNoOverflow` passes.
  - [x] A usage event for Claude does not change Codex's chip output.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The 80-column budget holds with the new segment
- Absent/not-ready agents show the honest unknown marker
- No new palette key and no inline hex color
