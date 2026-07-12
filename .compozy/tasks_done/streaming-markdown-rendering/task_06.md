---
status: completed
title: "Markdown rendering polish: tables, degradation, and clean copy"
type: frontend
complexity: medium
dependencies:
    - task_02
---

# Task 06: Markdown rendering polish: tables, degradation, and clean copy

## Overview
With the shared renderer in place, this task raises rendering robustness so the console stays trustworthy on the messy Markdown that LLMs actually emit.
Tables stay aligned across terminal resize, malformed or engine-unsupported Markdown degrades legibly instead of breaking, and selecting rendered tables or code copies clean source.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST configure the shared `Markdown` leaf's table options so tables wrap rather than truncate and stay aligned across terminal widths and resize (using OpenTUI `tableOptions` such as `wrapMode`/`columnFitter`).
- MUST ensure malformed Markdown (unbalanced fences, broken tables, bad nesting) and engine-unsupported elements (footnotes, task-list checkboxes) render legibly without crashing or leaking raw markers.
- MUST extend clean-copy so selecting a rendered table or code block yields clean text or source without box-drawing or gutter artifacts.
- MUST apply these behaviors through the shared leaf so every surface benefits.
</requirements>

## Subtasks
- [ ] 6.1 Set table options on the shared leaf for stable wrapping and alignment.
- [ ] 6.2 Verify malformed and engine-unsupported Markdown degrades legibly.
- [ ] 6.3 Ensure clean-copy for rendered tables and code.
- [ ] 6.4 Add tests for resize stability, degradation, and copy.

## Implementation Details
Modify `src/ui/Markdown.tsx` to pass `tableOptions` to the OpenTUI `<markdown>`, and add tests in `src/ui/Markdown.test.tsx`.
See TechSpec "System Architecture" and the OpenTUI table options referenced there, plus PRD "Core Features" (robust tables and graceful degradation) and ADR-003.

### Relevant Files
- `src/ui/Markdown.tsx` - the shared leaf where table options and rendering live.
- `src/ui/Markdown.test.tsx` - unit tests for the leaf.
- `src/ui/ConversationView.test.tsx` - the resize and selection harness patterns (mock mouse, resize) to reuse.

### Dependent Files
- `src/ui/MessageView.tsx` and `src/ui/HandoffPreview.tsx` - inherit the polish through the shared leaf.

### Related ADRs
- [ADR-003: Shared Markdown Renderer](../adrs/adr-003.md) - the leaf that owns these rendering options.

## Deliverables
- Table wrapping and alignment stable on resize, graceful degradation, and clean-copy for tables and code, all through the shared leaf.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration coverage that a transcript table stays aligned across a resize **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] A GFM table renders aligned columns and, after a narrower resize, wraps cells rather than truncating (compare `captureCharFrame` at two widths).
  - [ ] An unbalanced code fence renders as legible text without leaking raw fence markers or crashing.
  - [ ] A GFM task-list item renders its text legibly (no dropped item text) even though the engine draws no checkbox.
  - [ ] Selecting a rendered fenced code block copies the code without line-number or gutter artifacts (mock mouse `getSelectedText`).
- Integration tests:
  - [ ] A transcript message containing a table stays aligned across a resize event.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Tables stay aligned and wrap on resize, malformed and unsupported Markdown degrades legibly, and rendered tables and code copy cleanly.
