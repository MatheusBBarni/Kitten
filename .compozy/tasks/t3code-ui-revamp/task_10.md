---
status: completed
title: Add renderer workbench state and board-context restoration
type: frontend
complexity: high
---

# Task 10: Add renderer workbench state and board-context restoration

## Overview

Move card and attempt selection into the renderer's view-state boundary and
establish a stable workbench navigation contract. Opening a card preserves the
originating board context, while refreshes and missing entities resolve through
deterministic, accessible fallbacks without copying host workflow truth.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Selected card, selected attempt, workbench mode, and origin context MUST be renderer-owned view state rather than component-local state.
2. Opening the workbench MUST record the originating repository/board, board mode, logical scroll/stage anchor, and focus target.
3. Closing the workbench MUST restore valid origin context and focus.
4. Host revision refreshes MUST preserve still-valid selection and MUST choose a deterministic fallback when an entity disappears.
5. Drafts MUST be locally persisted by project, board, card, and source so composer and request-changes content cannot collide.
6. Zustand MUST NOT store copied card, attempt, queue, evidence, or lifecycle projections.
7. Draft persistence SHOULD fall back to in-memory behavior when `localStorage` is unavailable.
</requirements>

## Subtasks

- [ ] 10.1 Move card and attempt selection into the desktop view store.
- [ ] 10.2 Record workbench origin, board mode, anchors, and focus restoration targets.
- [ ] 10.3 Preserve selection across valid host revisions.
- [ ] 10.4 Resolve deleted board/card/attempt identities through deterministic fallbacks.
- [ ] 10.5 Namespace and preserve composer/request-changes drafts.
- [ ] 10.6 Bind board, shell, and inspector components to the view-state contract.
- [ ] 10.7 Add store, interaction, refresh, and focus-restoration coverage.

## Implementation Details

Follow the TechSpec **Renderer state and queries**, **Workbench**, and **Board
return** contracts. Replace the current component-local `selectedCardId` rather
than mirroring it in two places. Keep responsive presentation and visual styling
outside this state-foundation task.

### Relevant Files

- `packages/desktop/src/renderer/state/desktopViewStore.ts` — workbench selection, origin context, and draft namespaces.
- `packages/desktop/src/renderer/state/desktopViewStore.test.ts` — pure view-state transition coverage.
- `packages/desktop/src/renderer/features/board/WorkflowBoardContainer.tsx` — opens and closes workbench through the store.
- `packages/desktop/src/renderer/features/board/WorkflowBoardContainer.test.tsx` — board restoration behavior.
- `packages/desktop/src/renderer/features/inspector/CardInspector.tsx` — controlled attempt and draft integration.
- `packages/desktop/src/renderer/features/inspector/CardInspector.test.tsx` — workbench selection and draft behavior.

### Dependent Files

- `packages/desktop/src/renderer/main.tsx` — owns stable shell-level workbench navigation.

### Related ADRs

- [ADR-001: Adopt a T3 Code-Inspired Supervision Loop While Preserving Kitten's Workflow Model](adrs/adr-001.md) — board-preserving workbench.
- [ADR-003: Derive Supervision on Read and Keep Navigation Renderer-Local](adrs/adr-003.md) — primary view-state ownership decision.

## Deliverables

- Renderer-owned workbench selection, origin, fallback, and draft state.
- Board and inspector integration without duplicated host projections.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for board restoration, refresh, and focus behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Record board A's mode/anchor when opening card B from another board.
  - [ ] Restore origin board, mode, anchor, and focus target when closing.
  - [ ] Preserve a still-valid card and attempt across projection refresh.
  - [ ] Fall back to the latest attempt when only the selected attempt disappears.
  - [ ] Close to the nearest valid origin when the selected card disappears.
  - [ ] Isolate composer and request-changes drafts across projects, boards, cards, and sources.
  - [ ] Reset ephemeral view state without changing host projections.
- Integration tests:
  - [ ] Open a card without unmounting or resetting the board surface.
  - [ ] Close the workbench and restore the originating card/scroll anchor and keyboard focus.
  - [ ] Open a cross-project item while retaining the prior board return context.
  - [ ] Process revision messages without closing a valid workbench.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Board orientation survives card inspection, refresh, and supported fallback paths.
- Renderer state contains view references and drafts only.
