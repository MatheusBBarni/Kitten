---
status: pending
title: "Conversation view"
type: frontend
complexity: medium
dependencies:
  - task_08
---

# Task 09: Conversation view

## Overview
Render the focused agent's conversation: streamed Markdown messages, tool-call rows tagged by kind and status, and syntax-highlighted diffs for edits.
This is where the user actually reads what an agent is doing, so it must stream without flicker and present diffs legibly using OpenTUI's built-in components.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST render the focused agent's turns from the store: user messages, agent messages (streamed Markdown), and agent thoughts.
- MUST render tool-call rows showing `kind`, `title`, and `status`, updating in place as `tool_call_update`s arrive.
- MUST render `edit` tool-call diffs using OpenTUI's `<diff>` component.
- MUST render message content with OpenTUI's `<markdown>` component and keep streaming visually stable (no flicker), consuming already-coalesced updates from the store.
- MUST subscribe via a narrow selector to the focused agent's session only (ADR-004).
- MUST keep text selectable/copyable cleanly (no line-number or box-drawing bleed into selections), per the PRD UX.
</requirements>

## Subtasks
- [ ] 9.1 Render the turn list (user/agent/thought) for the focused session
- [ ] 9.2 Render streamed agent Markdown with stable, flicker-free updates
- [ ] 9.3 Render tool-call rows with kind/title/status and in-place updates
- [ ] 9.4 Render edit diffs via the `<diff>` component
- [ ] 9.5 Add `testRender` snapshots for streaming, tool calls, and diffs

## Implementation Details
Create the conversation view and its row/message subcomponents. See TechSpec "System Architecture → UI Shell" (`ConversationView`) and PRD UX (flicker-free, clean copy). Use OpenTUI `<markdown>` and `<diff>`. Mounts into the shell's conversation region from task_08.

### Relevant Files
- `src/ui/ConversationView.tsx` — new; the scrollable transcript
- `src/ui/MessageView.tsx` — new; a single message (Markdown)
- `src/ui/ToolCallRow.tsx` — new; a tool-call row with diff rendering
- `src/ui/ConversationView.test.tsx` — new; `testRender` snapshots

### Dependent Files
- `src/ui/CockpitApp.tsx` (task_08) — hosts the conversation region

### Related ADRs
- [ADR-004: React Binding for the OpenTUI UI Layer](adrs/adr-004.md) — narrow subscription and stable streaming

## Deliverables
- Conversation view rendering messages, tool calls, and diffs
- Unit tests with 80%+ coverage **(REQUIRED)**
- `testRender` snapshot/integration tests for streaming and diffs **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] A user turn and an agent turn render in order with distinct styling
  - [ ] A tool-call row shows `edit` kind and `in_progress` status, then updates to `completed` in place
  - [ ] An edit tool call renders its diff via the `<diff>` component
  - [ ] The view subscribes only to the focused agent's session (switching focus swaps the rendered transcript)
- Integration tests:
  - [ ] `testRender` snapshot of a streaming agent message settling over several coalesced updates matches the expected frames
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Messages, tool calls, and diffs render legibly and stream without flicker
- Selection/copy stays clean per the PRD UX requirement
