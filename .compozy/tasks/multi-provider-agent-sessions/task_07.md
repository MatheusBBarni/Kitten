---
status: pending
title: "Safe multi-session approvals labeling"
type: frontend
complexity: medium
dependencies:
  - task_03
---

# Task 07: Safe multi-session approvals labeling

## Overview
Label every approval prompt and status row with its session's title and working directory so a permission decision can never land in the wrong repository when several agents run at once.
This closes the wrong-session hazard the PRD calls out, especially for two sessions that share a provider and would otherwise be indistinguishable.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST render the requesting session's title and working directory in the approval overlay, reading the identity attached in task_03, per the TechSpec "Safe multi-session approvals" note.
- MUST disambiguate each status-strip chip and overview row enough (title plus directory) that two sessions of the same provider are never confused.
- MUST NOT auto-approve across sessions; every request is answered explicitly and the queued single-slot behavior is preserved, now identified per session.
- SHOULD keep the approval keybindings and layout otherwise unchanged so the flow stays familiar.
</requirements>

## Subtasks
- [ ] 7.1 Read the `SessionId`, title, and `cwd` from the approval overlay state.
- [ ] 7.2 Render the session title and directory in the approval prompt header.
- [ ] 7.3 Disambiguate status-strip chips and overview rows for same-provider sessions.
- [ ] 7.4 Confirm no cross-session auto-approve path exists and each queued request is answered on its own.

## Implementation Details
The approval overlay already carries the session identity after task_03; this task surfaces it in the UI per the TechSpec "Safe multi-session approvals" note.
Keep the modal approval behavior and its keymap; only the displayed attribution changes.

### Relevant Files
- `src/ui/ApprovalPrompt.tsx` - renders the approval prompt; add the session title and directory.
- `src/ui/StatusStrip.tsx` - chips must disambiguate same-provider sessions.
- `src/store/appStore.ts` - `ApprovalOverlay` shape (identity attached in task_03).

### Dependent Files
- `src/ui/SessionsOverlay.tsx` - overview rows share the same title-plus-directory labeling.

### Related ADRs
- [ADR-004: N-Session Identity Model](../adrs/adr-004.md) - two sessions of one provider need explicit disambiguation.

## Deliverables
- Approval prompts labeled with the requesting session's title and directory.
- Status and overview rows that disambiguate same-provider sessions.
- Confirmation that no cross-session auto-approve path exists.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests with two same-provider sessions requesting permission **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] The approval overlay renders the requesting session's title and `cwd` in its header.
  - [ ] Two sessions of the same provider produce visibly distinct approval headers (title plus directory differ).
  - [ ] Answering the on-screen approval settles only that session's request and leaves a queued request for another session pending.
- Integration tests:
  - [ ] Two same-provider sessions each request permission; assert each prompt names its own session and directory and that each decision routes to the correct agent connection.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- No approval can be attributed to the wrong session or directory
- No cross-session auto-approve path exists
