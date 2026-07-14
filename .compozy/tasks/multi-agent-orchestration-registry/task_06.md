---
status: pending
title: "Surface Delegated Children in Workspace Views"
type: frontend
complexity: high
---

# Task 6: Surface Delegated Children in Workspace Views

## Overview

Make delegated work visible in the existing tabs and `/sessions` overlay rather than creating a second orchestration workspace. Users must be able to read textual parent-child lineage, Running/needs-input/terminal state, group settlement, and navigate to the normal child transcript.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST extend narrow store selectors with stable delegation presentation data; React views MUST NOT read raw delegation records or derive lifecycle independently.
2. MUST render textual parent-child lineage and delegated `Running`, `Needs input`, `Finished`, `Failed`, and `Cancelled` labels in tabs and `/sessions`.
3. MUST distinguish delegated `Needs input` from the existing unread `needs you` attention badge and retain terminal child navigation to the normal transcript.
4. MUST show parent group state as active or settled without changing generic `SessionStatus` labels or injecting transcript summaries.
5. MUST preserve narrow-width overflow reachability, keyboard reopen/select behavior, and non-color accessibility.
</requirements>

## Subtasks

- [ ] 6.1 Extend cached selector projections with child lineage, lifecycle, and group state.
- [ ] 6.2 Add compact delegated parent/child labels to tab rendering.
- [ ] 6.3 Add detailed delegated lifecycle and result-navigation cues to session cards.
- [ ] 6.4 Preserve existing background reopen, attention, and narrow-width behavior.
- [ ] 6.5 Add tab and sessions-overlay regression coverage for every lifecycle label.

## Implementation Details

Use the TechSpec **Data Flow**, **PRD Traceability**, and selector contract. Terminal result inspection means opening the existing child transcript; do not create a result viewer, generic cancelled `SessionStatus`, or a parent transcript message.

### Relevant Files

- `src/store/selectors.ts` — extends cached session-list and workspace-view projections.
- `src/ui/TabWorkspace.tsx` — owns compact textual tab/group labels and overflow behavior.
- `src/ui/TabWorkspace.test.tsx` — owns tab label, selected-state, and narrow-width regression coverage.
- `src/ui/SessionsOverlay.tsx` — owns detailed session-card lineage, lifecycle, and navigation cues.
- `src/ui/SessionsOverlay.test.tsx` — owns background child, attention, terminal, and selection behavior tests.

### Dependent Files

- `src/core/orchestration.ts` — supplies ordered child and aggregate-state selectors.
- `src/store/appStore.ts` — supplies immutable delegation state and actions.
- `src/ui/ConversationView.tsx` — mounts the existing tab workspace without structural changes.
- `src/ui/CockpitApp.tsx` — mounts the existing sessions overlay without structural changes.

### Related ADRs

- [ADR-001: Use a flat, host-owned delegation registry for V1](adrs/adr-001.md) — requires normal focusable child sessions.
- [ADR-002: Prioritize fast, explicit child launch in the MVP](adrs/adr-002.md) — requires immediate Running feedback.
- [ADR-003: Keep delegation state protocol-free and ephemeral in AppState](adrs/adr-003.md) — requires selector-owned presentation.
- [ADR-004: Derive delegation completion from store selectors in V1](adrs/adr-004.md) — makes UI the group-completion consumer.

## Deliverables

- Stable selector projections for lineage, lifecycle, terminal availability, and aggregate group state.
- Accessible tab and session-card presentation for delegated work.
- Workspace UI regression coverage across active, needs-input, and terminal states.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for delegated child navigation **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] A selected parent with a background Running child shows an explicit active group cue without losing tab overflow access.
  - [ ] A reopened child tab/card identifies its parent and retains its delegated Running label.
  - [ ] A background child with `Needs input` shows both lineage/lifecycle text and the separate unread `needs you` badge.
  - [ ] Finished, failed, and cancelled children keep distinct textual terminal labels and remain navigable.
  - [ ] A group is settled only when every child is terminal; an active or needs-input child prevents settled presentation.
- Integration tests:
  - [ ] Selecting a child from `/sessions` reopens the normal transcript without changing parent-child ownership.
  - [ ] Long lineage labels at narrow widths retain the Sessions entry and scrollable child rows.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every delegated child is discoverable through existing workspace surfaces with text-based lineage and state.
- No view allocates uncached derived collections for unaffected session updates.
