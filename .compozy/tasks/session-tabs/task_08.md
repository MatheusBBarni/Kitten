---
status: completed
title: "Render tab strip and empty workspace"
type: frontend
complexity: high
---

# Task 08: Render tab strip and empty workspace

## Overview

Add the primary Session Tabs surface: a single-row tab strip above the active workspace plus an operable empty-workspace state. The surface must present visible conversations, status cues, mouse selection, narrow-screen overflow entry, and background-work access without stopping live work.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST render one single-row tab item for each Visible conversation in workspace order, with non-color selected, lifecycle, and attention cues.
2. MUST show deterministic duplicate-name disambiguation and a non-blocking shared-workspace cue from selector view models.
3. MUST select a tab through `ControllerActions.selectConversation` on OpenTUI mouse input without mutating store state directly.
4. MUST provide compact overflow access rather than multi-row wrapping and keep every hidden conversation reachable through SessionsOverlay.
5. MUST render a valid empty workspace with a New Conversation action, reachable background-work entry, and no-provider notice without fabricating a transcript or runtime.
</requirements>

## Subtasks
- [x] 8.1 Render visible tab items from narrow selector-derived view models.
- [x] 8.2 Add accessible selected, status, duplicate-name, and shared-workspace presentation.
- [x] 8.3 Route mouse selection and overflow activation through ControllerActions.
- [x] 8.4 Preserve single-row behavior across narrow and resized terminal layouts.
- [x] 8.5 Provide the empty-workspace primary action and background-work entry.

## Implementation Details

Use the TechSpec’s **UI and Input Design**, **Focus Authority and Empty Workspace**, and **PRD Requirement Mapping** sections. Keep the alternate-screen shell’s current full-height behavior and use stable SessionId keys with narrow subscriptions.

### Relevant Files
- `src/ui/TabWorkspace.tsx` — new tab-strip component and tab-item presentation.
- `src/ui/TabWorkspace.test.tsx` — new mouse, status, narrow-layout, and selector-isolation coverage.
- `src/ui/EmptyWorkspace.tsx` — new no-selected-tab workspace surface.
- `src/ui/EmptyWorkspace.test.tsx` — new creation, background entry, and no-provider notice coverage.
- `src/ui/CockpitApp.tsx` — mount tab/empty-workspace surfaces in the main pane.
- `src/ui/CockpitApp.test.tsx` — frame, resize, focus, and mounted behavior conventions.

### Dependent Files
- `src/store/selectors.ts` — tab, duplicate-name, shared-workspace, overflow, and background view models.
- `src/store/appStore.ts` — workspace selection, overlays, and notices.
- `src/app/actions.ts` — create and select action boundary.
- `src/app/controller.ts` — dynamic runtime creation and nullable lookup.
- `src/ui/ConversationView.tsx` — selected-conversation content boundary.
- `src/ui/PromptEditor.tsx` — must remain disabled when the workspace has no selected conversation.

### Related ADRs
- [ADR-001: Ship a Bounded, Attention-Safe Session-Tab Lifecycle](adrs/adr-001.md) — requires background work and urgent state to remain reachable.
- [ADR-002: Prioritize a Restorable, Fast-Switching Conversation Tab Workspace](adrs/adr-002.md) — defines visible/background/closed user experience.
- [ADR-005: Gate Requested Tab Chords on Kitty Keyboard Events and Retain Sessions Fallback](adrs/adr-005.md) — preserves mouse and overlay fallback navigation.

## Deliverables
- TabWorkspace and EmptyWorkspace components mounted in the cockpit.
- Mouse, overflow, background, empty-state, and accessibility behavior backed by selector-driven views.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests covering rendered selection, narrow layouts, and empty workspace behavior **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Visible tabs render in workspace order with non-color selected/working/approval/error/finished cues.
  - [x] Duplicate display names and shared CWDs receive deterministic visible disambiguation/cues.
  - [x] Mouse down selects exactly one target through ControllerActions and does not directly change store state.
  - [x] Narrow widths retain a single row, expose an overflow entry, and do not wrap tab items.
  - [x] Empty workspace exposes New Conversation, background-work access, and a no-provider notice after a null creation result.
- Integration tests:
  - [x] A mounted cockpit swaps the selected transcript while background conversations remain live.
  - [x] Resize and overflow interactions keep every conversation reachable without layout overflow.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing.
- Test coverage >=80%.
- Two to four live conversations are visibly distinguishable and mouse-selectable.
- Empty/background-only workspaces remain operable without app exit or fabricated state.
