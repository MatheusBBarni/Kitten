---
status: pending
title: "Integrate Delegation State into AppStore"
type: backend
complexity: medium
---

# Task 2: Integrate Delegation State into AppStore

## Overview

Add the ephemeral delegation projection to `AppState` and make delegated child registration one atomic store update. The parent must remain selected while a background child session, workspace entry, and ownership record appear together.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add an immutable ephemeral `delegation` slice to `AppState` and reset it whenever ordinary sessions are replaced during restore.
2. MUST add a single delegated-session store operation that inserts the session, creates and backgrounds its workspace entry, and records ownership in one notification.
3. MUST preserve parent selection, focused pane, and unrelated structural references during delegated registration and lifecycle publication.
4. MUST route session status through the existing `sessionReducer`; delegation state MUST NOT hand-write `SessionState` or hold interaction payloads, runtime handles, or persistence fields.
</requirements>

## Subtasks

- [ ] 2.1 Add the delegation slice and narrow store action surface.
- [ ] 2.2 Compose existing pure workspace transitions into atomic background child registration.
- [ ] 2.3 Project accepted child lifecycle updates without duplicating session reducer logic.
- [ ] 2.4 Reset delegation state during normal restore replacement and clean up only removed child entries.
- [ ] 2.5 Add store integration coverage for atomicity and structural sharing.

## Implementation Details

Follow the TechSpec **Store and Controller Contract**. Do not call public `addSession()` followed by `backgroundConversation()`, because that briefly focuses a child and emits an incomplete observable state.

### Relevant Files

- `src/store/appStore.ts` — owns `AppState`, commit atomicity, session insertion, status routing, replacement, and removal.
- `src/store/appStore.test.ts` — owns workspace lifecycle integration and restore-replacement coverage.
- `src/store/selectors.ts` — exposes narrow selector-ready delegation projections.
- `src/core/orchestration.ts` — provides immutable state and reducer helpers.
- `src/core/workspace.ts` — provides pure create/background transitions to compose before commit.

### Dependent Files

- `src/app/controller.ts` — invokes delegated registration and lifecycle publication.
- `src/ui/TabWorkspace.tsx` — consumes stable parent/group projections.
- `src/ui/SessionsOverlay.tsx` — consumes stable child lifecycle and lineage projections.

### Related ADRs

- [ADR-001: Use a flat, host-owned delegation registry for V1](adrs/adr-001.md) — requires visible normal child sessions.
- [ADR-003: Keep delegation state protocol-free and ephemeral in AppState](adrs/adr-003.md) — defines store ownership and no restore graph.
- [ADR-004: Derive delegation completion from store selectors in V1](adrs/adr-004.md) — requires immutable narrow projections.

## Deliverables

- `AppState.delegation` and atomic delegated registration/removal actions.
- Restore reset and no-persistence behavior at the store boundary.
- Store tests for lifecycle projection, focus preservation, and structural sharing.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for delegated session insertion and restore **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] One subscriber observes exactly one insertion state containing the child session, background workspace entry, and delegation record.
  - [ ] Delegated insertion keeps the parent selected/focused and retains unrelated session/workspace references.
  - [ ] A child starts with `starting` availability and accepted status events retain normal attention behavior.
  - [ ] Duplicate or missing ids and no-op lifecycle events preserve the complete state reference.
  - [ ] Removing a child removes only its session, workspace entry, and delegation entry.
- Integration tests:
  - [ ] `replaceSessions()` restores ordinary conversations but always installs an empty delegation projection.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- No observer can see an unowned, selected, or visible delegated child during launch.
- Restored ordinary sessions never regain parent-child ownership.
