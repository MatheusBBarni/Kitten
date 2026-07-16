---
status: completed
title: Disclose managed launch semantics and tab identity
type: frontend
complexity: medium
---

# Task 07: Disclose managed launch semantics and tab identity

## Overview

Explain the committed-base contract in the delegation dialog and add one compact, text-readable managed-worktree cue to child tabs. This task makes launch and active-work identity understandable without guessing an exact binding before provisioning or bloating the tab row with path details.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST state that a child starts from the parent committed HEAD and excludes uncommitted parent changes.
2. MUST preserve existing draft, pending, trim, null-failure, and modal behavior in the delegation dialog.
3. MUST consume the selector-owned review presentation and render one concise non-color-only tab cue.
4. MUST keep detailed path, branch, SHA, cleanup, and refusal content out of the one-row tab surface.
</requirements>

## Subtasks
- [x] Add committed-base and dirty-work exclusion disclosure to child launch.
- [x] Preserve fail-soft dialog behavior around provisioning outcomes.
- [x] Render compact managed/review tab identity from the selector presentation.
- [x] Preserve narrow-layout overflow and ordinary child labeling.
- [x] Add mounted dialog and tab coverage.

## Implementation Details

Consume existing `ControllerActions` and the shared selector presentation described in the TechSpec UI surfaces. Do not add keymaps, cleanup routing, raw binding reads, or status-strip changes.

### Relevant Files
- `src/ui/DelegationDialog.tsx` — current child launch draft and pending/failure UX.
- `src/ui/DelegationDialog.test.tsx` — mounted launch dialog behavior.
- `src/ui/TabWorkspace.tsx` — compact selector-derived tab labels.
- `src/ui/TabWorkspace.test.tsx` — tab label and narrow-layout coverage.

### Dependent Files
- `src/ui/SessionsOverlay.tsx` — later owns detailed review and cleanup routing.
- `src/store/selectors.ts` — supplies managed/review presentation.

### Related ADRs
- [ADR-001: Create managed worktrees only for spawned child sessions](adrs/adr-001.md) — committed-base isolation.
- [ADR-002: Make in-Kitten review the primary completion loop](adrs/adr-002.md) — clear review identity.

## Deliverables
- Delegation-dialog committed-base disclosure and compact tab cue.
- Mounted UI tests with >=80% coverage **(REQUIRED)**.
- Integration coverage for available and unavailable presentation without raw Git reads **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Launch dialog visibly discloses committed HEAD and dirty-work exclusion.
  - [x] Existing validation, pending, and generic failure behavior remains unchanged.
  - [x] Managed/review tab cue is readable without color and ordinary tabs remain unchanged.
- Integration tests:
  - [x] Terminal and unavailable selector states render compactly while Sessions remains discoverable in narrow layouts.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- No UI claim exposes an unverified exact branch/path before provisioning.
- Tabs remain compact while clearly distinguishing managed child work.
