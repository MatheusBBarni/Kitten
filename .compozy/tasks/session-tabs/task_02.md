---
status: completed
title: "Integrate workspace state into AppStore and selectors"
type: refactor
complexity: high
---

# Task 02: Integrate workspace state into AppStore and selectors

## Overview

Move selection, lifecycle, and tab-oriented derived state into the AppStore while retaining normalized execution sessions. The store and selectors must support nullable selection, background attention, and stable per-tab rendering during concurrent streaming.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST make `WorkspaceState.selectedVisibleId` the only mutable authority for agent selection and represent workspace focus explicitly when no Visible tab is selected.
2. MUST expose atomic workspace mutations for dynamic session insertion/removal, rename, select, background, reopen, teardown state, and availability without directly mutating `SessionState`.
3. MUST update workspace attention metadata when execution transitions into approval, error, or finished status.
4. MUST provide narrow selectors for visible tabs, background work, duplicate labels, shared-workspace cues, and attention routing with stable identities for unrelated streamed sessions.
5. MUST preserve overlay precedence and approval identity while allowing a background conversation to remain attention-eligible.
</requirements>

## Subtasks
- [x] 2.1 Replace independent focused-session ownership with workspace selection.
- [x] 2.2 Add atomic store mutations for workspace lifecycle and dynamic execution slices.
- [x] 2.3 Extend focus and overlay state for an empty workspace without invalid agent references.
- [x] 2.4 Produce stable tab, background, duplicate-label, shared-workspace, and attention selectors.
- [x] 2.5 Verify streaming isolation, attention acknowledgement, and modal precedence.

## Implementation Details

Follow the TechSpec’s **Focus Authority and Empty Workspace**, **Attention Rules**, and **UI and Input Design** sections. Keep lifecycle policy in the workspace reducer and use the store only to compose it with execution state and overlays.

### Relevant Files
- `src/store/appStore.ts` — AppState, FocusedPane, overlays, atomic commits, and store action surface.
- `src/store/appStore.test.ts` — state mutation, no-op, subscription, and structural-sharing conventions.
- `src/store/selectors.ts` — focused, list, attention, overlay, and cached derived view models.
- `src/store/selectors.test.ts` — selector value, identity, focus, and modal tests.
- `src/core/types.ts` — protocol-free types shared by store and selectors.
- `src/core/workspace.ts` — lifecycle reducer and invariants consumed by AppStore.

### Dependent Files
- `src/ui/CockpitApp.tsx` — consumes focus, overlays, and global modal state.
- `src/ui/SessionsOverlay.tsx` — reads ordered conversation and attention views.
- `src/ui/PromptEditor.tsx` — must tolerate nullable selection.
- `src/ui/HandoffTargetPicker.tsx` — consumes session-list filtering and selection.
- `src/app/controller.ts` — writes runtime events and invokes store workspace mutations.
- `src/persistence/runWriter.ts` — snapshots selected/empty workspace state.

### Related ADRs
- [ADR-001: Ship a Bounded, Attention-Safe Session-Tab Lifecycle](adrs/adr-001.md) — protects background attention and lifecycle semantics.
- [ADR-004: Separate Workspace Metadata from Session State and Persist a Versioned Workspace](adrs/adr-004.md) — makes workspace metadata the single source of selection and lifecycle.

## Deliverables
- AppStore support for workspace-owned lifecycle, null selection, dynamic sessions, and tab-dialog-ready overlay state.
- Stable selector view models for tabs, background conversations, shared workspaces, and attention.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests exercising store updates through streamed session events and modal state **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Seeded, dynamic, and empty stores retain valid workspace selection and pane state.
  - [x] Rename/background/reopen operations preserve the associated `SessionState` reference.
  - [x] Execution transitions create attention epochs without clearing status; selection acknowledges only the current epoch.
  - [x] Visible/background/attention selectors order and filter conversations correctly while duplicate names and shared CWDs remain deterministic.
  - [x] Unrelated streamed session updates preserve unrelated tab selector identities.
- Integration tests:
  - [x] A background conversation’s approval remains attributed to its original SessionId while a different tab is selected.
  - [x] Open overlays suppress global focus changes and retain their captured target identity.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing.
- Test coverage >=80%.
- Empty workspace, background work, and nullable selection are first-class store states.
- Tab selector updates stay narrow during concurrent agent streaming.
