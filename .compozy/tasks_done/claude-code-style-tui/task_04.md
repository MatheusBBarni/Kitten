---
status: completed
title: "Prompt chevron and spacing restyle"
type: frontend
complexity: low
dependencies:
    - task_01
---

# Task 04: Prompt chevron and spacing restyle

## Overview
Restyle the prompt editor to match the reskin: a chevron prompt marker, tuned spacing, and the warm accent, all read from the palette.
Behavior (submit, interrupt, placeholder, the disabled skin) stays exactly as it is; this is purely visual.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a chevron prompt marker before the textarea in `PromptEditor`.
- MUST apply spacing and the warm accent via `usePalette()` (task_01) — no hard-coded color.
- MUST NOT change submit, interrupt, or placeholder behavior, or the height-growth logic.
- MUST preserve the disabled ("agent unavailable") skin: disabled title, disabled placeholder, and the not-ready border.
</requirements>

## Subtasks
- [ ] 4.1 Add the chevron marker element inside the prompt box.
- [ ] 4.2 Adjust the box layout/padding for the new spacing.
- [ ] 4.3 Keep the ready and disabled skins intact.
- [ ] 4.4 Update `PromptEditor.test.tsx` for the marker and preserved behavior.

## Implementation Details
Modify `src/ui/PromptEditor.tsx` (the render body around the bordered box + textarea) and `src/ui/PromptEditor.test.tsx`.
Read the accent from `theme.ts` (task_01). See ADR-004 and the TechSpec "System Architecture" (Prompt restyle).

### Relevant Files
- `src/ui/PromptEditor.tsx` — the bordered, titled box wrapping the `<textarea>`.
- `src/ui/theme.ts` — accent from task_01.
- `src/ui/PromptEditor.test.tsx` — existing behavior assertions to preserve.

### Dependent Files
- None significant; the editor's public behavior is unchanged.

### Related ADRs
- [ADR-004: Extend the Existing Palette Instead of Building the Theme Registry](adrs/adr-004.md) — Accent comes from the palette.

## Deliverables
- Restyled `PromptEditor` with a chevron marker and accent, behavior unchanged.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test: submit and interrupt still work after the restyle **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] The chevron marker is present in the ready state and uses `palette.accent`.
  - [ ] The disabled skin still shows the disabled title, disabled placeholder, and not-ready border.
  - [ ] The placeholder text is unchanged in the ready state.
- Integration tests:
  - [ ] Pressing Enter still submits the prompt through the controller after the restyle.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Prompt behavior (submit, interrupt, disabled state) is byte-for-byte unchanged
- The chevron and spacing read from the palette, not inline color
