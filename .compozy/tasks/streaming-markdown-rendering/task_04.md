---
status: pending
title: "Render the hand-off summary as Markdown"
type: frontend
complexity: medium
dependencies:
  - task_01
  - task_02
---

# Task 04: Render the hand-off summary as Markdown

## Overview
The hand-off summary - the prose a reviewer must trust before forwarding a task to the other agent - is shown as an unformatted textarea.
This task renders the summary as Markdown in read mode while keeping it editable, lifting the draft into React state so the read view, the edit textarea, and the send path share one source of truth and no edit is ever dropped.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST lift the summary into React state (seeded from `bundle.summary`) as the single source of truth.
- MUST render the summary through the shared `Markdown` leaf in read mode and through the existing `<textarea>` (bound to the state) in edit mode.
- MUST make `send()`/`flow.confirm` read the summary from state, so an edited summary is always forwarded and never silently reverts to `bundle.summary`.
- MUST preserve the redaction-notice visibility, the `editing`/Escape key routing, and the approval-overlay-outranks-preview behavior.
- MUST NOT alter the referenced-files or diffs sections or the send/cancel semantics beyond the summary source.
</requirements>

## Subtasks
- [ ] 4.1 Introduce a `summaryDraft` state seeded from `bundle.summary`.
- [ ] 4.2 Render read mode via the shared `Markdown` leaf and edit mode via the textarea bound to the draft.
- [ ] 4.3 Point `send()` at the draft state.
- [ ] 4.4 Preserve the redaction notice, the edit toggle, and Escape routing.
- [ ] 4.5 Add tests covering read rendering, edit-then-send fidelity, and key routing.

## Implementation Details
Modify `src/ui/HandoffPreview.tsx`: the `summary` ref/textarea in the summary section, the `editing` state, and `send()`, consuming the shared `Markdown` leaf from task_02.
See TechSpec "Implementation Design > Core Interfaces" for the summary-state shape and "System Architecture" for the data flow, and ADR-002/ADR-003.

### Relevant Files
- `src/ui/HandoffPreview.tsx` - the summary textarea, `editing` state, `send()`, redaction notice, and key routing.
- `src/ui/Markdown.tsx` - the shared leaf produced by task_02.
- `src/ui/HandoffPreview.test.tsx` - the existing preview harness (seed store, open overlay via Ctrl+T, assert frames).

### Dependent Files
- `src/app/handoff.ts` - `flow.confirm` receives the summary; the contract is unchanged but exercised.

### Related ADRs
- [ADR-002: PRD Product Approach - Preview-Deep](../adrs/adr-002.md) - the console is the center of gravity.
- [ADR-003: Shared Markdown Renderer](../adrs/adr-003.md) - the leaf the read view uses.

## Deliverables
- A read-mode rendered summary and an edit-mode textarea bound to shared state; `send()` reads that state.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration test that an edited summary is the text actually forwarded **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Read mode renders `## Plan` as a styled heading span (via `captureSpans`), not raw `##`.
  - [ ] Pressing the edit key focuses the textarea and Escape returns to read mode.
  - [ ] Editing the summary and confirming forwards the EDITED text, not `bundle.summary` (assert via `controller.calls.sendPrompt`).
  - [ ] The redaction notice stays visible in read mode with the correct count and color.
  - [ ] While editing, non-Escape keys reach the textarea rather than the list commands, and Escape leaves edit mode.
- Integration tests:
  - [ ] Full hand-off: open the preview (Ctrl+T), read the rendered summary, edit it, press Enter, and the receiving agent's prompt carries the edited summary.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The summary renders as Markdown in read mode and stays editable, and no edit is ever dropped on send.
- The redaction notice and key routing are preserved.
