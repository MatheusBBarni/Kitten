---
status: pending
title: "Status strip model and effort display"
type: frontend
complexity: low
dependencies:
  - task_04
---

# Task 07: Status strip model and effort display

## Overview
Show each pane's current model and effort in the status strip so the configuration is always visible and the selector is discoverable by seeing its state.
This is a small, read-only addition to the existing per-agent chip.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST display the current model and effort for each agent in `AgentStatusChip`, sourced from `selectAgentModel`/`selectAgentEffort`.
- MUST omit the effort segment when the agent exposes no effort, and omit the whole model/effort segment when the agent advertises nothing.
- MUST subscribe through memoized curried selectors so the chip does not re-render on unrelated state changes.
- MUST NOT change the existing focus marker or status label behavior.
</requirements>

## Subtasks
- [ ] 7.1 Read `selectAgentModel`/`selectAgentEffort` in `AgentStatusChip` via memoized selectors
- [ ] 7.2 Render the model and effort segment next to the display name and status
- [ ] 7.3 Handle the no-effort and no-options cases by omitting segments
- [ ] 7.4 Cover the rendered chip states with tests

## Implementation Details
Modify the status chip. See TechSpec "System Architecture" (UI Shell) and "User Experience" (discoverability). Mirror the memoized selector usage already in `AgentStatusChip` (`StatusStrip.tsx:69-89`, e.g. `statusSelector = useMemo(() => selectAgentStatus(agentId), [agentId])`).

### Relevant Files
- `src/ui/StatusStrip.tsx` — `AgentStatusChip` (69-89), render at 82-88
- `src/store/selectors.ts` (task_04) — `selectAgentModel`/`selectAgentEffort`
- `src/ui/StatusStrip.test.tsx` — rendered chip tests

### Dependent Files
- none (leaf UI change)

### Related ADRs
- [ADR-001: V1 scope](adrs/adr-001.md) — always-visible current setting (feature F5)

## Deliverables
- Model and effort shown in each agent's status chip
- Unit tests with 80%+ coverage **(REQUIRED)**
- Rendered integration test of the chip states **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] A chip for an agent with model `opus` and effort `high` renders both values alongside the status
  - [ ] A chip for an agent with a model but no effort omits the effort segment
  - [ ] A chip for an agent advertising no options omits the whole model/effort segment
  - [ ] Changing only the status does not change the rendered model/effort segment
- Integration tests:
  - [ ] Rendering the full `StatusStrip` through `CockpitApp` shows both agents' model/effort, updating when a `config_options` event is dispatched
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Each pane's current model and effort are visible in the status strip
- The chip re-renders only on relevant state changes
