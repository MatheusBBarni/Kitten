---
status: pending
title: Add targeted unavailable-Cursor recheck
type: backend
complexity: medium
---

# Task 03: Add targeted unavailable-Cursor recheck

## Overview

Give a user who completes a local recovery action one deliberate way to recheck only the unavailable Cursor session. The action must reuse Kitten's guarded per-session lifecycle while preserving every healthy sibling runtime, connection, subscription, and focus state.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. `ControllerActions` MUST expose a public `recheckCursor(sessionId)` action that never rejects into the UI and reports unexpected action-seam failures through the target session's existing error route.
2. Recheck MUST be inert for unknown, non-Cursor, ready, unconfigured, closing, or controller-dead sessions.
3. A valid recheck MUST restart only the selected unavailable Cursor runtime through existing preflight, connection, session, and availability behavior while preserving its `SessionId`.
4. The target restart MUST create a fresh generation, dispose or unsubscribe stale target resources, clear stale ACP identity, and re-enable event acceptance before it can become ready.
5. A failed recheck MUST retain the target's bounded normalized reason and MUST NOT add a core event, persistent state, telemetry category, automatic retry loop, or direct CLI fallback.
6. Recheck MUST NOT change focus or mutate healthy sibling runtime, store, connection, session, or subscription identities.
</requirements>

## Subtasks
- [ ] 3.1 Expose one UI-safe Cursor recheck action through the controller action boundary.
- [ ] 3.2 Reinitialize only an eligible unavailable Cursor runtime with a fresh guarded lifecycle generation.
- [ ] 3.3 Preserve target failure normalization and all healthy sibling state during successful and failed rechecks.
- [ ] 3.4 Cover no-op eligibility cases and no-throw public-action behavior.

## Implementation Details

Use the TechSpec sections **System Architecture**, **Core Interfaces**, and **Development Sequencing**. Reuse controller lifecycle and availability seams; do not let UI code reach `AgentConnection`, add a generic provider restart abstraction, or route recheck through the pure reducer.

### Relevant Files
- `src/app/controller.ts` — session lifecycle, preflight, failure handling, generation fencing, restoration preparation, and targeted recheck seam.
- `src/app/actions.ts` — public `ControllerActions` façade and fail-soft action containment.
- `src/app/controller.test.ts` — injected preflight/connection lifecycle and sibling-isolation coverage.
- `src/app/actions.test.ts` — public action and rejected-seam containment coverage.
- `src/config/readiness.ts` — existing bounded preflight and connection-failure normalization to reuse.

### Dependent Files
- `src/store/appStore.ts` — existing availability updates and structural sharing for unaffected siblings.
- `src/core/types.ts` — existing runtime and session identity contracts.
- `src/agent/agentConnection.ts` — adapter lifecycle remains dependency-only and ACP-contained.
- `src/ui/ModelSelect.tsx` — later renders recovery and invokes the public action without direct controller internals.

### Related ADRs
- [ADR-002: Define support by a completed first Cursor task after reviewed proof](adrs/adr-002.md) — Requires user recheck after recovery.
- [ADR-004: Recheck only the selected unavailable Cursor session](adrs/adr-004.md) — Constrains the new action to the target session.

## Deliverables

- One no-throw target-session Cursor recheck action with fresh lifecycle generation handling.
- Focused controller/action coverage for recovery, repeated failure, inert calls, and sibling isolation.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for targeted recovery without provider disruption **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] An unavailable Cursor whose injected preflight becomes ready receives one new connection/session and becomes ready.
  - [ ] A recheck after `authentication_required` disposes the failed target transport, creates a distinct replacement session, and makes only Cursor promptable again.
  - [ ] Recheck of a ready Cursor, Codex, unknown ID, closing session, or unconfigured session performs no preflight, connection creation, or state mutation.
  - [ ] A rejected recheck seam reports only through `onError` and never causes an unhandled rejection.
- Integration tests:
  - [ ] Ready Claude Code and Codex runtime/store references, connection counters, and promptability remain unchanged while Cursor recovers.
  - [ ] A continued Cursor failure remains unavailable with the current bounded recovery state while siblings remain usable.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Only the selected eligible Cursor session is restarted by a deliberate recheck.
- Healthy provider sessions remain uninterrupted and UI callbacks never reject.
