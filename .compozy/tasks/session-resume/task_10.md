---
status: pending
title: "Session delete from the picker"
type: frontend
complexity: medium
dependencies:
  - task_02
  - task_09
---

# Task 10: Session delete from the picker

## Overview
Because persistence is on by default and runs are kept forever, the user needs an easy way to remove them.
This adds per-session delete and a global delete-all to the picker, with a confirmation step, so data control lives exactly where the user browses their runs.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a per-session delete action in the picker that removes the selected run via the run store and updates the list.
- MUST add a global delete-all action that clears all runs via the run store.
- MUST require a confirmation before either deletion so a single keystroke cannot destroy data.
- MUST refresh the visible list after a deletion and show an empty state when the last run is removed.
- MUST only delete Kitten's own run records; it MUST NOT delete an agent's own session store.

## Subtasks
- [ ] 10.1 Add a per-session delete binding and call `runStore.delete`
- [ ] 10.2 Add a delete-all binding and call `runStore.deleteAll`
- [ ] 10.3 Add a confirmation step before deletion
- [ ] 10.4 Refresh the list and handle the empty state
- [ ] 10.5 Cover single delete, delete-all, confirmation, and empty state in tests

## Implementation Details
Modify `src/ui/SessionPicker.tsx` (task_09) to add the delete bindings, confirmation, and list refresh, calling `delete`/`deleteAll` on the run store (task_02).
Keep the deletion scoped to Kitten's records per ADR-003; see the TechSpec "Core Features" (Data control).

### Relevant Files
- `src/ui/SessionPicker.tsx` — the picker overlay to extend (task_09)
- `src/persistence/runStore.ts` — `delete` and `deleteAll` (task_02)

### Dependent Files
- `src/ui/SessionPicker.test.tsx` — extend for delete cases

### Related ADRs
- [ADR-003: Cockpit-Run Persistence](../adrs/adr-003.md) — per-session and global delete of Kitten's records

## Deliverables
- Per-session delete and global delete-all in the picker, with confirmation
- List refresh and empty-state handling
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test deleting a run from the picker and confirming it is gone **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] confirming delete on a selected row calls `runStore.delete` with that `runId` and the row disappears
  - [ ] delete-all (confirmed) calls `runStore.deleteAll` and the list becomes empty
  - [ ] a delete requires confirmation: the first keystroke prompts, the second performs it
  - [ ] deleting the last run shows the empty state
  - [ ] deletion targets only Kitten's run store (no agent session-delete call is made)
- Integration tests:
  - [ ] deleting a run from the picker removes its file and a subsequent list no longer shows it
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Users can delete a single run or all runs from the picker, behind a confirmation
- Only Kitten's own records are removed
