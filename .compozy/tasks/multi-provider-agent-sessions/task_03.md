---
status: pending
title: "Controller: one runtime per session with its own working directory"
type: backend
complexity: high
dependencies:
  - task_01
  - task_02
---

# Task 03: Controller: one runtime per session with its own working directory

## Overview
Generalize the session controller from two fixed agents to one runtime per resolved session descriptor, each opening its ACP session against its own working directory.
This removes the single-shared-directory limitation, keys runtimes by `SessionId`, runs readiness per session, and carries session identity into the approval flow so later tasks can label decisions.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST key runtimes as `Map<SessionId, AgentRuntime>` and start one runtime per resolved session descriptor, calling `newSession(cwd)` with that session's own directory, per the TechSpec "Component Overview" section.
- MUST carry the `SessionId`, `title`, and `cwd` into `store.openApproval` so an approval can be attributed to its session (the labeling UI is task_07).
- MUST evaluate readiness per session and surface a not-ready session with its reason without blocking the rest of the fleet, per ADR-005 and the first-run gate.
- MUST preserve per-session degradation: one session failing to spawn leaves every other session fully usable.
- SHOULD send a session's optional first `task` as its opening prompt when the descriptor carries one.
</requirements>

## Subtasks
- [ ] 3.1 Key `runtimes` by `SessionId` and start one runtime per resolved session descriptor.
- [ ] 3.2 Open each ACP session against its descriptor's own `cwd`.
- [ ] 3.3 Aggregate per-session readiness into the first-run report without blocking the fleet on one bad session.
- [ ] 3.4 Attach `SessionId`, `title`, and `cwd` to the parked approval request.
- [ ] 3.5 Send the descriptor's optional first `task` as the opening prompt.

## Implementation Details
Extend `createSessionController` and the boot path per the TechSpec "Component Overview" section.
`getSession` and the actions resolve by `SessionId`; the approval queue keeps its single-slot behavior but each parked request now names its session.
Per-session readiness feeds `buildFirstRunReport`, and a session pointed at a non-repository directory follows the ADR-005 guidance (reported not-ready, fleet not blocked).

### Relevant Files
- `src/app/controller.ts` - `createSessionController`, `startAgent`, `getSession`, `runtimes`, and the approval enqueue.
- `src/config/firstRun.ts` - the readiness/report aggregation, now per session.
- `src/index.ts` - boot wiring that builds the controller and runs the readiness gate.

### Dependent Files
- `src/store/appStore.ts` - `ApprovalOverlay` gains `sessionId`, `title`, and `cwd`.
- `src/app/actions.ts` - `getSession`/`AgentSession` resolve by `SessionId`.
- `src/agent/agentConnection.ts` - `newSession(cwd)` is called per session.

### Related ADRs
- [ADR-004: N-Session Identity Model](../adrs/adr-004.md) - runtimes keyed by `SessionId`.
- [ADR-005: Fleet Configuration Model](../adrs/adr-005.md) - per-session `cwd` and per-session readiness.

## Deliverables
- A controller starting one runtime per session, each in its own directory, keyed by `SessionId`.
- Per-session readiness surfaced in the first-run report without blocking the fleet.
- Approval requests attributed to their session.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests booting a multi-session fleet **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Three descriptors, two sharing a provider, produce three runtimes whose `newSession` calls receive three distinct working directories.
  - [ ] A descriptor whose connection fails to spawn is recorded not-ready with its reason while the other sessions report ready.
  - [ ] Enqueuing a permission request opens the approval overlay carrying that session's `SessionId`, `title`, and `cwd`.
  - [ ] A descriptor carrying a first `task` sends that text as the opening prompt on start.
  - [ ] A session pointed at a non-repository directory is reported not-ready without setting the whole report to blocked.
- Integration tests:
  - [ ] Boot with a three-session config against mock connections and assert live runtimes, focus on the first ready session, and per-session directories used across the `newSession` calls.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Each session runs in its own working directory
- One failing session never blocks the rest of the fleet
