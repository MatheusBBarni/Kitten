---
status: pending
title: Render Shared Colored Statusline Segments
type: frontend
complexity: high
---

# Task 04: Render Shared Colored Statusline Segments

## Overview

Render the color-bearing core segments through one narrow presentation helper
used by both the active footer and the `/statusline` preview. This preserves
the existing one-line, width-aware cockpit behavior while making explicit field
colors visible only on field text and keeping separators visually muted.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- Add one shared presentation boundary that consumes rendered segments and theme palette values without validating layouts, calculating widths, or emitting terminal control sequences.
- Render an explicitly colored field with its canonical color, an uncolored field with `palette.text`, and every separator with `palette.muted`.
- Use the same helper in the active custom footer and overlay preview so their field/separator semantics cannot drift.
- Preserve current terminal-width behavior, shell hint, null-layout behavior, unavailable-field omission, save/cancel/recovery interactions, and canonical configuration diff output.
- Do not add background colors, separator colors, opacity, automatic contrast adjustments, visual editing controls, or a second rendering model.
</requirements>

## Subtasks

- [ ] 4.1 Establish a shared UI presentation surface for rendered statusline segments and palette foreground policy.
- [ ] 4.2 Replace flattened custom footer output with the shared segment presentation while retaining existing footer behavior.
- [ ] 4.3 Replace flattened preview output with the same presentation and retain exact reviewed configuration changes.
- [ ] 4.4 Verify active and preview surfaces agree across explicit colors, theme defaults, muted separators, missing values, and constrained widths.

## Implementation Details

Follow the TechSpec's shared presentation-helper design and keep UI components
as controller-driven consumers. Core remains the owner of accepted layouts,
segment text, and width budgeting; this task owns only presentation policy.

### Relevant Files

- `src/ui/statuslineSegments.tsx` — new shared segment-to-OpenTUI presentation helper.
- `src/ui/StatusStrip.tsx` — active custom footer integration.
- `src/ui/StatusStrip.test.tsx` — active-footer rendering and existing-behavior coverage.
- `src/ui/StatuslineOverlay.tsx` — `/statusline` preview and reviewed-diff integration.
- `src/ui/StatuslineOverlay.test.tsx` — mounted preview, interaction, and constrained-width coverage.

### Dependent Files

- `src/core/statusline.ts` — supplies width-bounded, color-bearing segments.
- `src/ui/theme.ts` — supplies the existing text and muted palette values.

### Related ADRs

- [ADR-001: Keep statusline colors item-local and declarative](adrs/adr-001.md) — limits visible styling to explicit field foreground color.
- [ADR-003: Carry canonical colors through the pure statusline model](adrs/adr-003.md) — separates pure segment construction from UI presentation.

## Deliverables

- A shared statusline segment presenter with field and separator foreground policy.
- Active footer and preview adoption of that presenter.
- Mounted UI coverage for explicit colors, theme defaults, muted separators, preview parity, and width behavior.
- Focused UI suites plus the project regression commands required by the TechSpec for the completed user-facing implementation.

## Tests

- Unit tests:
  - [ ] Explicit field colors apply only to the matching field text.
  - [ ] Uncolored field text uses the active theme text color and separators use the muted palette color.
  - [ ] The shared helper does not alter segment order, text, or width-bounded omission decisions from core.
- Integration tests:
  - [ ] Mounted active footer and `/statusline` preview render equivalent colored and uncolored segment semantics.
  - [ ] 64- and 80-column layouts remain one line without overflow while preserving shell hint, null layout, and missing-value behavior.
  - [ ] The preview diff shows canonical colors and save, cancel, invalid-proposal, and recovery interactions retain their current behavior.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- Footer and preview share a single field/separator foreground policy.
- Explicit colors never affect separators or uncolored fields.
- Existing footer and preview behavior remains intact for layouts with no colors.
- All focused tests and the required full regression gate pass with >=80% targeted coverage.
