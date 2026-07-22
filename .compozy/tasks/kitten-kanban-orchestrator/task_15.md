---
status: completed
title: Build accessible canvas, stage setup, and board card interactions
type: frontend
complexity: high
---

# Task 15: Build accessible canvas, stage setup, and board card interactions

## Overview

Build the desktop renderer's accessible Workflow Board: blank setup, editable
linear canvas, catalog-backed stage defaults, and card interactions. The
renderer proposes typed commands and renders host projections; it never
reimplements authoritative graph rules or accesses privileged resources.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. A blank board MUST offer an explicit editable starter template and manual setup; it MUST NOT silently seed or overwrite an existing workflow.
2. The canvas MUST show only ordered immediate-successor arrows and use stable projected stage identities/version for pointer and keyboard reorder.
3. Stage creation MUST foreground valid catalog-backed default-Skill selection; unconfigured or invalid stages MUST state why they are not runnable.
4. Cards MUST display Workflow Stage and Execution Status as distinct text labels, select an inspector route, and expose only host-valid settled movement.
5. The renderer MUST use typed RPC queries, mutations, and committed projection events only.
6. Pointer and keyboard operation, visible focus, semantic labels, non-color cues, accessible conflicts, and a keyboard path to selected/attention cards MUST all be present.
</requirements>

## Subtasks

- [ ] 15.1 Implement pure canvas interaction helpers for projected path affordances.
- [ ] 15.2 Build blank-board/template/manual setup and committed-projection board shell.
- [ ] 15.3 Build catalog-backed stage setup with valid/unconfigured states.
- [ ] 15.4 Add accessible reorder/connect controls and typed conflict presentation.
- [ ] 15.5 Render stage/status-distinct cards, locks, movement, and inspector selection.
- [ ] 15.6 Add fake-RPC component and interaction coverage.

## Implementation Details

Follow the TechSpec Typed Desktop RPC and Linear Workflow Canvas mapping. The
current terminal UI is a UX reference only; desktop renderer state remains
disposable and narrow.

### Relevant Files

- packages/desktop/src/renderer/features/board/WorkflowBoard.tsx — board shell and cards.
- packages/desktop/src/renderer/features/board/WorkflowBoard.test.tsx — board component coverage.
- packages/desktop/src/renderer/features/board/workflowCanvas.ts — pure projected-canvas helpers.
- packages/desktop/src/renderer/features/board/workflowCanvas.test.ts — canvas interaction coverage.
- packages/desktop/src/renderer/features/board/StageSetupDialog.tsx — stage/default-Skill setup.
- packages/desktop/src/renderer/features/board/StageSetupDialog.test.tsx — setup accessibility coverage.
- packages/desktop/src/renderer/features/board/boardInteractions.ts — typed mutation affordances.

### Dependent Files

- packages/desktop/src/shared/rpc.ts — typed command/query contract.
- packages/desktop/src/catalog/skillCatalog.ts — catalog identity source.
- packages/desktop/src/workflow/workflowCommands.ts — authoritative host validation.

### Related ADRs

- [ADR-001: Constrain V1 to a linear governed workflow with queued active-run input](adrs/adr-001.md) — linear canvas and movement governance.
- [ADR-002: Make Attention Blockers the V1 supervision priority](adrs/adr-002.md) — keyboard-visible attention state.
- [ADR-006: Resolve Workflow Skills from deterministic project and user catalog roots](adrs/adr-006.md) — default Skill identity.

## Deliverables

- Accessible blank/setup board and editable single-path canvas.
- Catalog-backed stage defaults, stage/status-distinct cards, and typed host interactions.
- Renderer interaction and accessibility regression suite.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for fake RPC projection refresh **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Derive only immediate arrows and stable keyboard/pointer reorder intents from a one-path projection.
  - [ ] Render explicit template/manual choice, separate stage/status labels, and typed stale-version conflicts.
  - [ ] Require a valid catalog identity for stage setup and expose collision/invalid diagnostics.
  - [ ] Verify running and needs-attention cards show disabled movement and Stage Lock text.
- Integration tests:
  - [ ] Use fake typed RPC to refresh board projections after stage and card commands.
  - [ ] Complete creation and reorder using keyboard-only visible-focus controls.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The canvas can never propose branching, joining, cycles, or free-text Skill selection.
- Every board state is usable without pointer-only or color-only cues.
