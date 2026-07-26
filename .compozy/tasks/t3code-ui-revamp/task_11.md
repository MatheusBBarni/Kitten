---
status: pending
title: Build the cross-project Work Inbox
type: frontend
complexity: high
---

# Task 11: Build the cross-project Work Inbox

## Overview

Turn the existing project sidebar into an actionable cross-project Work Inbox
without replacing repository and board navigation. It renders host-provided
priority groups, preserves current search and project preferences, and opens a
selected card through the board-preserving workbench contract.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. The Work Inbox MUST render host-provided groups in fixed attention, review, failed, running, and settled order.
2. The renderer MUST preserve item order and counts from the host and MUST NOT reimplement lifecycle priority.
3. Each item MUST provide repository, board, card, status, actionable time, and bounded evidence availability with text labels.
4. Search and repository scope MUST continue to work across project/board navigation and card-level supervision items.
5. Selecting an item MUST record current return context, switch to the item's board/card, and open the workbench within two interactions.
6. Refresh MUST NOT close a still-valid workbench or discard drafts/anchors.
7. Groups/items MUST support keyboard traversal, visible focus, semantic labels/counts, and explicit empty/loading/unavailable states.
</requirements>

## Subtasks

- [ ] 11.1 Render authoritative grouped counts and ordered supervision rows.
- [ ] 11.2 Integrate card-level results with existing project/board search and scope.
- [ ] 11.3 Open selected items through board/card/workbench navigation.
- [ ] 11.4 Preserve valid selection and context during projection refresh.
- [ ] 11.5 Add accessible group, item, loading, error, and empty-state behavior.
- [ ] 11.6 Preserve existing pin, archive, hide, and board-selection preferences.
- [ ] 11.7 Add rendering, filtering, navigation, refresh, and keyboard coverage.

## Implementation Details

Follow the TechSpec **Work Inbox**, **Supervision read**, and **Supervision
Ordering** sections. Extend the current sidebar at its actual feature path;
do not create the stale `renderer/components/ProjectSidebar.tsx` path from the
impact table. Use component utilities rather than adding component-specific
rules to the global stylesheet.

### Relevant Files

- `packages/desktop/src/renderer/features/board/ProjectSidebar.tsx` — grouped Work Inbox and project navigation.
- `packages/desktop/src/renderer/features/board/ProjectSidebar.test.tsx` — rendering, filtering, selection, and accessibility coverage.
- `packages/desktop/src/renderer/features/board/useWorkflowBoardController.ts` — supervision query consumption and board switching.
- `packages/desktop/src/renderer/features/board/WorkflowBoardContainer.tsx` — card/workbench navigation from inbox selection.
- `packages/desktop/src/renderer/features/board/WorkflowBoardContainer.test.tsx` — cross-board selection and refresh behavior.

### Dependent Files

- `packages/desktop/src/renderer/query/desktopQueries.ts` — supervision query options and invalidation.
- `packages/desktop/src/renderer/state/desktopViewStore.ts` — selected item and return-context actions.

### Related ADRs

- [ADR-001: Adopt a T3 Code-Inspired Supervision Loop While Preserving Kitten's Workflow Model](adrs/adr-001.md) — inbox complements the Kanban hierarchy.
- [ADR-002: Make Blocked Work and Evidence-Bound Review First-Class](adrs/adr-002.md) — group order and evidence availability.
- [ADR-003: Derive Supervision on Read and Keep Navigation Renderer-Local](adrs/adr-003.md) — host ordering and renderer navigation.

## Deliverables

- Cross-project grouped Work Inbox integrated with existing navigation.
- Accessible, refresh-safe card selection and workbench opening.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for cross-project selection and projection refresh **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Render groups and counts in exact host order without local re-prioritization.
  - [ ] Match repository, board, and card labels while retaining group boundaries.
  - [ ] Render distinct empty workspace, filtered-empty, loading, and typed unavailable guidance.
  - [ ] Navigate using durable board/card identities from a selected item.
  - [ ] Keep evidence-unavailable items visible without enabling review actions.
  - [ ] Reach every group/item by keyboard with correct accessible names and current state.
- Integration tests:
  - [ ] Open a card in another repository while recording the current board anchor.
  - [ ] Update counts/items on refresh without closing a valid workbench.
  - [ ] Recover to a valid board and announce when the selected card disappears.
  - [ ] Refetch supervision once without per-board N+1 reads.
  - [ ] Preserve the same selection across wide/narrow mode changes.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Actionable cards are reachable within the PRD's two-interaction target.
- Status, order, counts, and evidence availability remain host-authoritative.
