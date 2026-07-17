---
status: completed
title: Project bounded Cursor recovery state
type: backend
complexity: medium
---

# Task 07: Project bounded Cursor recovery state

## Overview

Project a closed, user-safe Cursor recovery state from normalized readiness outcomes into workspace availability. This gives later recheck and UI work a stable source of truth without exposing or relying on the free-form runtime error string.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Protocol-free `ConversationAvailability` MUST gain an optional closed Cursor recovery projection for unavailable sessions that carries only stable reason/action semantics and whether recheck is meaningful.
2. Every Cursor preflight and normalized long-lived connection result MUST map to that projection before workspace availability is published, while non-Cursor sessions retain the existing generic availability contract.
3. Recovery state MUST never derive from, persist, select, render, or telemetry-record `AgentRuntimeState.error`, raw ACP errors, commands, paths, versions, credentials, or probe output.
4. A selector MUST return the safe recovery projection only for an unavailable Cursor session and MUST return `null` for missing, ready, and non-Cursor sessions.
5. `retryable` MUST remain distinct from the user-remediable/recheckable decision; an unreviewed certification state MUST be non-remediable even when a configured runtime exists.
6. Availability structural sharing MUST publish a changed recovery state to subscribers while preserving references when all values are equal.
7. Initial, restored, and later recheck-compatible Cursor failures MUST use the shared projection boundary without adding UI copy, public actions, adapter calls, telemetry fields, or persistent configuration.
</requirements>

## Subtasks
- [ ] 7.1 Define the closed protocol-free Cursor recovery projection and preserve generic non-Cursor availability.
- [ ] 7.2 Map bounded preflight and connection outcomes through the shared availability failure boundary.
- [ ] 7.3 Expose recovery state through a selector with safe null behavior.
- [ ] 7.4 Preserve structural sharing and cover initial, restored, and raw-error failure cases.

## Implementation Details

Follow the TechSpec sections **Data Models**, **System Architecture**, and **Testing Approach**. The recovery vocabulary must remain sealed (binary missing, version mismatch, native authentication required, uncertified recipe, and generic handshake recovery) and the presentation layer later maps those values to user copy.

### Relevant Files
- `src/core/types.ts` — protocol-free availability and sealed recovery-state contract.
- `src/core/workspace.ts` — availability mutation and structural-sharing comparison.
- `src/core/workspace.test.ts` — recovery-only update and reference-preservation coverage.
- `src/store/selectors.ts` — safe target-session recovery projection selector.
- `src/store/selectors.test.ts` — null and unavailable Cursor selector coverage.
- `src/app/controller.ts` — shared failure boundary for preflight, connection, restore, and recheck-compatible outcomes.
- `src/app/controller.test.ts` — normalized projection, raw-detail exclusion, and sibling-isolation coverage.

### Dependent Files
- `src/config/readiness.ts` — remains the bounded source of preflight and connection causes.
- `src/app/actions.ts` — later exposes recheck only when the safe projection permits it.
- `src/ui/ModelSelect.tsx` — later maps stable recovery values to copy and affordance visibility.
- `src/telemetry/recorder.ts` — remains unchanged and limited to existing closed readiness categories.

### Related ADRs
- [ADR-001: Keep Cursor support evidence-gated and fail closed](adrs/adr-001.md) — Requires a closed, content-free support boundary.
- [ADR-004: Recheck only the selected unavailable Cursor session](adrs/adr-004.md) — Requires a safe state that can determine recheck eligibility.

## Deliverables

- Closed user-safe Cursor recovery projection and selector with no raw runtime details.
- Structural-sharing and controller failure-path regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for failure-to-availability projection **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Each preflight cause projects the matching safe Cursor recovery state without constructing Cursor or leaking injected raw details.
  - [ ] Authentication and arbitrary handshake failures yield safe projection values without raw transport text in store or selector output.
  - [ ] The recovery selector is `null` for ready, non-Cursor, and missing sessions.
  - [ ] A recovery-only availability change updates the target conversation; equal values preserve workspace/conversation references and siblings retain identity.
- Integration tests:
  - [ ] A restore failure traverses the shared failure boundary and receives the same bounded recovery projection as initial startup.
  - [ ] Exhaustive type coverage accounts for every closed recovery value and preserves ready Claude Code and Codex session availability.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Cursor recovery state is safe, sealed, and independent of free-form runtime errors.
- Later UI and recheck work can determine recovery behavior without protocol or sensitive details.
