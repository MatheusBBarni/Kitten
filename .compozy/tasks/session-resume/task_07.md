---
status: completed
title: "Restore orchestration with per-agent degradation"
type: backend
complexity: high
dependencies:
    - task_02
    - task_04
    - task_06
---

# Task 07: Restore orchestration with per-agent degradation

## Overview
This is the core of resume: given a persisted run record, rebuild both agent panes, restore focus, and record each pane's live-or-unavailable status.
It mirrors the controller's existing `startAgent` ordering so the streamed replay from `loadSession` repopulates the transcript through the path already in place, and it degrades each agent independently.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a controller entry point that restores a `PersistedRunRecord`, restoring each agent independently.
- Per agent, MUST connect, then call `loadSession(storedSessionId, cwd)` when the agent advertises `canLoadSession` and a stored id exists, else fall back to `newSession(cwd)`.
- MUST call `store.startSession(agentId, resultSessionId)` to bind and reset the slice BEFORE subscribing `onUpdate -> store.applyEvent`, so replayed history is not dropped.
- MUST set `restoration` to `"live"` on a successful load and `"unavailable"` when the capability is absent, the load fails, or the transcript is gone.
- MUST degrade each agent independently (mirroring `failAgent`) so one failure never blocks the other.
- After both agents, MUST call `store.setFocus(record.focusedAgentId)`.

## Subtasks
- [ ] 7.1 Add a `restoreAgent` routine mirroring `startAgent` ordering
- [ ] 7.2 Branch load-vs-new on `canLoadSession` and a stored id
- [ ] 7.3 Bind the slice before subscribing, then subscribe updates
- [ ] 7.4 Set `restoration` live/unavailable per agent and degrade independently
- [ ] 7.5 Add a controller restore entry taking a record and setting focus
- [ ] 7.6 Cover ordering, degradation, focus, and the fallback branch in tests

## Implementation Details
Modify `src/app/controller.ts` (`startAgent`, `failAgent`, `AgentRuntime`, `createSessionController`) to add the restore path, using `loadSession`/`canLoadSession` from task_04, `startSession`/`setFocus`/`setRestoration` from task_06, and `PersistedRunRecord` from task_02.
The ordering constraint (bind before subscribe) is the same one documented at the existing `startAgent` call site; see the TechSpec "Development Sequencing" step 4 and ADR-004.

### Relevant Files
- `src/app/controller.ts` — `startAgent` (the ordering to mirror), `failAgent`, `createSessionController`
- `src/agent/agentConnection.ts` — `loadSession`, `ReadyState.canLoadSession` (task_04)
- `src/store/appStore.ts` — `startSession`, `setFocus`, `setRestoration` (task_06)
- `src/persistence/runRecord.ts` — `PersistedRunRecord` input (task_02)

### Dependent Files
- `src/index.ts` — task_08 invokes restore at boot
- `src/ui/SessionPicker.tsx` — task_09 invokes restore from the picker
- `src/app/controller.test.ts` — extend with restore cases

### Related ADRs
- [ADR-004: Live Restore via loadSession Replay](../adrs/adr-004.md) — the restore ordering and two-state degradation
- [ADR-001: Two-Layer Whole-Cockpit Resume](../adrs/adr-001.md) — relationship restored reliably, liveness best-effort

## Deliverables
- A controller restore entry point and a per-agent `restoreAgent` routine
- Per-agent `restoration` status set during restore and focus set from the record
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test restoring a writer-produced record into a populated store with fake connections **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] with `canLoadSession: true`, restore calls `loadSession` and streamed history repopulates the pane's turns
  - [ ] `startSession` runs before `onUpdate` subscription: an update emitted immediately after `loadSession` is not dropped
  - [ ] a `loadSession` rejection sets `restoration` to `"unavailable"` for that agent while the other agent still restores `"live"`
  - [ ] `canLoadSession: false` takes the `newSession` fallback and sets `restoration` to `"unavailable"`
  - [ ] focus is set to `record.focusedAgentId` after both agents are restored
- Integration tests:
  - [ ] a record produced by the autosave writer restores into a populated store (fake connections) with focus and per-agent status correct
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A record restores both panes with correct ordering, per-agent status, and focus
- One agent's failure never blocks the other's restore
