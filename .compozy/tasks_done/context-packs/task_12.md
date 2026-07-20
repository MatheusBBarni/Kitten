---
status: completed
title: Context Pack File Explorer membership
type: frontend
complexity: high
---

# Task 12: Context Pack File Explorer membership

## Overview

Add a focused session-addressed File Explorer to the Context Pack panel for explicit whole-file membership. It reuses safe discovery and existing revision-aware operator actions without becoming a second local draft or broad repository browser.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- Discovery MUST call ControllerActions.listRepositoryFiles for the panel's captured session; the component MUST have no direct filesystem access.
- Membership MUST project selectContextPack for the same session and keep no mutable local pack copy.
- Quick add/remove MUST affect only exact whole-file selection identity and use the existing revision-aware operator mutation action.
- Loading, empty, unavailable, stale, sealed-only, and typed-denial states MUST be explicit and non-actionable when appropriate.
- A stale discovery response MUST never replace a newer session's files or membership.
</requirements>

## Subtasks

- [x] 12.1 Add a session-addressed Context Pack File Explorer component.
- [x] 12.2 Render safe repository-relative paths and whole-file membership states.
- [x] 12.3 Wire keyboard/mouse add and remove to the addressed operator action.
- [x] 12.4 Mount the explorer in the Context Pack panel.
- [x] 12.5 Add stale-result, identity, denial, and panel-routing coverage.

## Implementation Details

Follow the TechSpec File Explorer membership rules. Existing prompt @ completion is not a reusable persistent explorer and must not be repurposed for this surface.

### Relevant Files

- src/ui/ContextPackFileExplorer.tsx — new safe membership component.
- src/ui/ContextPackFileExplorer.test.tsx — discovery, selection, and keyboard coverage.
- src/ui/ContextPackPanel.tsx — mount explorer for the captured panel session.
- src/ui/ContextPackPanel.test.tsx — addressed-session mount/wiring coverage.

### Dependent Files

- src/app/actions.ts — listRepositoryFiles and revision-aware operator mutation facade.
- src/app/fileDiscovery.ts — trusted safe repository-relative discovery source.
- src/store/selectors.ts — session-scoped Context Pack projection.
- src/core/contextPack.ts — full-file identity and transition contract.
- src/ui/FileSelector.tsx — prompt-local @ selector that remains separate.

### Related ADRs

- [ADR-001: Plan the full Context Packs contract with evidence-gated vertical delivery](adrs/adr-001.md)
- [ADR-002: Launch Context Packs as a verified-provider pilot for trusted focused handoffs](adrs/adr-002.md)
- [ADR-003: Keep Context Packs session-keyed and persist only manifests plus sealed bytes](adrs/adr-003.md)

## Deliverables

- Session-addressed safe file list and explicit whole-file membership states.
- Keyboard-accessible Add to Context Pack and Remove from Context Pack actions.
- Stale/blocked/empty/loading feedback with no implicit selection.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for addressed-session panel behavior with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Ready discovery renders lexical paths and marks an existing whole-file selection as in the Context Pack.
  - [x] Enter and Space add an unselected whole file then remove exactly that whole-file identity.
  - [x] Removing a whole-file entry does not remove a same-path slice or diff selection.
  - [x] Loading, empty, and unavailable states have explicit text and no actionable file row.
  - [x] Missing draft, sealed-only state, stale mutation, and typed denial preserve selections and show bounded feedback.
- Integration tests:
  - [x] A deferred session-A discovery response is ignored after the panel switches to session B.
  - [x] The mounted explorer always receives the panel's captured session rather than a later global focus.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Membership changes are addressed, identity-safe, and explicitly operator initiated.
- Explorer presentation cannot read files directly or replace a newer session's state.
