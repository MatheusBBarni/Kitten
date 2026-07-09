---
status: pending
title: "Shared Markdown renderer leaf and MessageView migration"
type: frontend
complexity: medium
dependencies:
  - task_01
---

# Task 02: Shared Markdown renderer leaf and MessageView migration

## Overview
Introduce a single shared `Markdown` leaf that owns the syntax style, the streaming pin, and conceal, so every surface renders Markdown identically and the OpenTUI dependency is named in one place.
Migrate MessageView's two `<markdown>` call sites to it, mirroring the existing `ToolCallDiffBody`/`ToolCallDiffView` shared-component pattern.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `src/ui/Markdown.tsx` exporting a `Markdown` component that calls `useSyntaxStyle()` and `usePalette()` in its own body and renders the OpenTUI `<markdown>` with `streaming` hard-pinned to `MARKDOWN_STREAMING` (not a caller-toggleable prop) and `conceal` enabled.
- MUST expose only a minimal prop surface (`content`, optional `fg`); the leaf owns `syntaxStyle` and streaming.
- MUST migrate both `UserMessage` and `AgentMessage` in `src/ui/MessageView.tsx` to render through `Markdown` with no visual regression to role labels, the user-message surface band, or spacing.
- MUST preserve `getSelectedText()` copy-cleanliness; the leaf MUST NOT introduce borders or box glyphs.
- MUST keep theme-mode reactivity by resolving `syntaxStyle`/palette inside the leaf, not accepting frozen props.
</requirements>

## Subtasks
- [ ] 2.1 Create the shared `Markdown` leaf mirroring `ToolCallDiffBody`.
- [ ] 2.2 Replace MessageView's two `<markdown>` call sites with the shared leaf, keeping role labels and the user-message band.
- [ ] 2.3 Add unit tests for the leaf covering structure styling, the streaming pin, and copy-cleanliness.
- [ ] 2.4 Confirm the existing ConversationView streaming/no-flicker test still passes.

## Implementation Details
Create `src/ui/Markdown.tsx` and modify `src/ui/MessageView.tsx`.
Mirror the shared-leaf shape of `ToolCallDiffBody` (a leaf that resolves `useSyntaxStyle()` internally) wrapped by thin per-surface components.
See TechSpec "Implementation Design > Core Interfaces" for the `MarkdownProps` shape and "System Architecture" for the seam's responsibilities.

### Relevant Files
- `src/ui/MessageView.tsx` - the two current `<markdown content syntaxStyle streaming fg>` call sites (`UserMessage`, `AgentMessage`) and `MARKDOWN_STREAMING`.
- `src/ui/ToolCallRow.tsx` - `ToolCallDiffBody`/`ToolCallDiffView` shared-leaf pattern to mirror.
- `src/ui/theme.ts` - `useSyntaxStyle`/`usePalette` the leaf consumes.
- `src/ui/ConversationView.test.tsx` - the streaming/no-flicker test that must keep passing.

### Dependent Files
- `src/ui/HandoffPreview.tsx` - will consume the shared leaf in task_04.

### Related ADRs
- [ADR-003: Shared Markdown Renderer](../adrs/adr-003.md) - the shared-leaf boundary this task builds.

## Deliverables
- `src/ui/Markdown.tsx` shared leaf; MessageView migrated to it.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration test that the ConversationView streaming path still passes **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Rendering `# H` styles the heading span with a non-default foreground (via `captureSpans`).
  - [ ] Rendering `**bold**` sets the bold attribute (`span.attributes & 1`).
  - [ ] A multi-block document (heading + paragraph + fenced code) renders without blanking, proving the streaming pin is held.
  - [ ] Selecting a rendered line via mock mouse copies the words only, with no box glyphs.
  - [ ] MessageView keeps distinct treatment: the agent turn shows its role label and the user turn keeps its surface band.
- Integration tests:
  - [ ] The existing ConversationView streaming test (a heading survives every appended delta) still passes after migration.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- One shared `Markdown` leaf is the only place the OpenTUI `<markdown>` element is used for prose.
- MessageView renders through the leaf with no visual regression, and the streaming pin and theme reactivity are preserved.
