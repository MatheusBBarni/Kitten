---
status: completed
title: "PromptEditor async @ selector integration and regressions"
type: frontend
complexity: high
---

# Task 06: PromptEditor async @ selector integration and regressions

## Overview

Integrate the completed repository source, explicit-session action, telemetry facade, selector presentation, and pure completion helpers into PromptEditor. The finished interaction must preserve every current prompt and slash-menu behavior while adding a keyboard-first @ flow that is session-correct, fail-soft, non-blocking, and never auto-sends a prompt.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST capture the focused session id when @ completion starts, load through `ControllerActions`, and invalidate menu, cache, suppression, and late results when focus changes.
2. MUST keep one active completion variant at a time, reuse existing menu navigation, and capture Enter only when a selectable file row is armed.
3. MUST insert the exact helper-formatted visible reference plus a trailing space without sending a prompt or mutating agent-observed file state.
4. MUST render loading, empty, and unavailable states without capturing ordinary typing or clearing the draft; Escape MUST apply the approved suppression lifecycle.
5. MUST track accepted reference ranges locally for one-time correction telemetry, record all required content-free events through controller actions, and retain no path/query/prompt content in telemetry.
6. MUST preserve existing slash completion, readiness gating, textarea sizing, shell shortcut, and prompt submission behavior.
</requirements>

## Subtasks
- [x] 6.1 Extend the PromptEditor completion state and lifecycle with the @ variant.
- [x] 6.2 Load, cache, filter, and invalidate explicit-session repository candidates.
- [x] 6.3 Render FileSelector and route menu navigation/selection without altering prompt-send behavior.
- [x] 6.4 Apply dismissal suppression and accepted-reference correction tracking.
- [x] 6.5 Emit content-free selector metrics through controller actions.
- [x] 6.6 Update the UI controller double and add mounted regression coverage.

## Implementation Details

Follow TechSpec "System Architecture > Prompt-local completion", "Data Models", "Testing Approach", and "Monitoring and Observability". This is the convergence task: consume the contracts from tasks 02–05 rather than recreating their interfaces or policies inside PromptEditor.

### Relevant Files
- `src/ui/PromptEditor.tsx` — owns the textarea, slash completion, local state, and key ordering.
- `src/ui/PromptEditor.test.tsx` — mounted Kitty-keyboard interaction suite to extend.
- `src/ui/FileSelector.tsx` — task_04 presentation leaf.
- `src/ui/fileCompletion.ts` — task_05 pure token, ranking, formatting, suppression, and correction helpers.
- `src/ui/cockpitContext.tsx` — controller access and narrow store subscription pattern.
- `test/fakeController.ts` — UI test double that must implement discovery and metric action calls.

### Dependent Files
- `src/ui/SlashMenu.tsx` — existing slash behavior must remain unchanged.
- `src/ui/keymap.ts` — reused `MENU_KEYMAP` governs navigation and Enter/Escape semantics.
- `src/app/actions.ts` — task_02 and task_03 action contracts called from the editor.
- `src/telemetry/recorder.ts` — receives only content-free facts emitted by the action facade.

### Related ADRs
- [ADR-001: Keep @ File Selection as an Honest, On-Demand Single-File Reference](adrs/adr-001.md) — prohibits attachment claims, auto-send, and tool-derived file-history mutation.
- [ADR-002: Limit V1 to Normal Repository Files and Preserve Composition on No Match](adrs/adr-002.md) — requires non-blocking empty and unavailable behavior.
- [ADR-003: Discover Repository Files Through an Injected Controller-Owned Git Source](adrs/adr-003.md) — requires explicit-session scope, focus-lifetime cache, and stale-result protection.
- [ADR-004: Keep @ Completion Local to the Prompt Token](adrs/adr-004.md) — defines token, Enter, Escape suppression, and formatting behavior.
- [ADR-005: Use Conservative Attributes and Bounded Binary Detection](adrs/adr-005.md) — ensures only source-validated paths reach this UI.

## Deliverables
- Updated `PromptEditor` with the full async @ selector lifecycle.
- Updated `PromptEditor.test.tsx` and `test/fakeController.ts` for ready, unavailable, deferred, and metric scenarios.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for mounted @ selection, dismissal, focus switching, correction, and slash-menu regression **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] A valid @ token starts one explicit-session discovery request and later query edits use the warm local list without another request.
  - [x] Ready results filter and highlight correctly; loading, empty, and unavailable states expose no selectable row or Enter interception.
  - [x] Selection inserts plain and quoted references with a trailing space and leaves `sendPrompt` untouched.
  - [x] Escape suppression survives continued typing in the same token and clears on trigger deletion, cursor departure, new token, and focus change.
  - [x] Pending reference edits emit exactly one content-free correction; submission clears pending tracking.
  - [x] Telemetry calls contain fixed facts only and include warm-query rendered timing.
- Integration tests:
  - [x] Arrow, Tab, Shift+Tab, Return, and keypad Enter select the highlighted path without sending; the following Enter submits the completed draft.
  - [x] Focus changes while a deferred old-session request is pending ignore its late result and require fresh discovery for the new session.
  - [x] A not-ready session can display discovery results but cannot submit the draft until readiness changes.
  - [x] Existing slash command selection, ! shell shortcut, Shift+Enter, and working-agent Escape interruption retain their current behavior.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The @ selector is keyboard-first, session-correct, fail-soft, and inserts only visible prompt text.
- Existing PromptEditor behaviors and slash completion remain regression-covered.
