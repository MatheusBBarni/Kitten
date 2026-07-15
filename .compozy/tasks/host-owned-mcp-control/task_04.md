---
status: pending
title: Make delegated-session registration selection-neutral
type: refactor
complexity: medium
---

# Task 04: Make delegated-session registration selection-neutral

## Overview

Remove the UI-only focus policy from the shared delegated-session store registration primitive. This enables a valid authenticated background parent to gain visible children without changing the developer’s selected conversation, while leaving UI launch policy in the controller.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. `addDelegatedSession` MUST accept a valid registered parent even when it is not `selectedVisibleId`.
- 2. Registration MUST preserve the exact pre-registration visible selection after the new child is backgrounded.
- 3. Existing parent existence, duplicate identity, delegation, session, workspace, and atomic-commit guards MUST remain unchanged.
- 4. The store MUST NOT gain MCP types, capabilities, routes, runtime ownership, or UI action policy.
</requirements>

## Subtasks

- [ ] 4.1 Remove the shared registration primitive’s selected-parent rejection.
- [ ] 4.2 Preserve the pre-registration visible conversation through background child creation.
- [ ] 4.3 Retain all existing registration and delegation invariants.
- [ ] 4.4 Add an atomic background-parent regression test.

## Implementation Details

Follow the TechSpec “Controller Behavior” and amended Impact Analysis. The workspace reducer’s create/background sequence changes selection transiently, so preserve the original selection within the same store commit; do not move the UI guard into the store.

### Relevant Files
- `src/store/appStore.ts` — `addDelegatedSession` selection policy and atomic registration behavior.
- `src/store/appStore.test.ts` — delegated-session store integration and atomic-commit regression coverage.

### Dependent Files
- `src/core/workspace.ts` — explains selection changes during conversation creation and backgrounding.
- `src/app/controller.ts` — retains the UI-only selected-parent guard for direct user-initiated launches.
- `src/app/actions.ts` — continues to delegate UI actions without taking on store policy.

### Related ADRs
- [ADR-001: Expose a bounded start-and-poll MCP surface](adrs/adr-001.md) — requires controller-owned entry without a UI dialog restriction.
- [ADR-003: Extend the authenticated Kitten MCP bridge with atomic bounded agent control](adrs/adr-003.md) — records the approved selection-neutral shared primitive.

## Deliverables

- A selection-neutral delegated-session registration primitive.
- Store regression coverage for a valid background-parent child registration.
- Preserved registration invariants and one-commit store behavior.
- Unit tests with 80%+ coverage.

## Tests

- Unit tests:
  - [ ] A selected `codex` conversation remains selected when a background `claude-code` parent registers a delegated child.
  - [ ] The accepted child is backgrounded, `starting`, and owned by the requested parent and generation.
  - [ ] Existing sessions, conversations, focused pane, and overlays retain their expected identities after registration.
  - [ ] A subscription observes one atomic store commit for the accepted registration.
  - [ ] Missing parents, duplicate child IDs, and invalid delegation registration remain rejected without mutation.
- Integration tests:
  - [ ] The existing controller UI launch path still rejects a non-selected parent after the store change.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Valid route-authorized background launches never steal the developer’s visible selection.
- The store remains protocol-free and retains all existing registration guards.
