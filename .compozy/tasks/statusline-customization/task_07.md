---
status: pending
title: "Render Saved Custom Layouts While Retaining the Legacy Footer"
type: frontend
complexity: medium
---

# Task 07: Render Saved Custom Layouts While Retaining the Legacy Footer

## Overview

Teach the footer to render a saved custom statusline through the shared pure renderer while leaving the current legacy strip completely unchanged when no custom layout exists. The footer remains one line, responds to terminal width changes, and keeps its existing help or shell-exit affordance and overflow containment.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST select the saved custom layout narrowly and use the shared pure renderer only when `preferences.statusline.layout` is non-null.
- MUST retain the existing legacy `StatusStrip` output, workspace summary, status chips, padding, and help or shell-exit hint exactly when no layout is saved.
- MUST derive context only from existing selected-session and runtime read models; it MUST NOT add Git, agent, filesystem, or config I/O to the UI.
- MUST use reactive terminal dimensions for the renderer budget, preserve declared-order trailing omission, and keep `wrapMode="none"` plus hidden overflow as display containment.
- MUST cover custom field order, unavailable values, grapheme branch ellipsis, 64/80-column behavior, resize response, and no-overflow rendering.
</requirements>

## Subtasks

- [ ] 7.1 Add a custom-layout render branch to the status strip while retaining the legacy-null branch unchanged.
- [ ] 7.2 Map existing focused-session, runtime, selector, and shell-hint values into the pure renderer context without new I/O.
- [ ] 7.3 Supply the current reactive terminal width to the renderer and retain single-line containment styles.
- [ ] 7.4 Extend direct strip coverage for legacy, custom ordering, unavailable values, ellipsis, and constrained widths.
- [ ] 7.5 Extend cockpit integration coverage for bottom-pinned footer behavior across terminal resize.

## Implementation Details

Implement TechSpec "OpenTUI width" and "StatusStrip" impact guidance. `StatusStrip` already mounts as the bottom row except in the full-height shell path; add only a custom-layout presentation branch and leave rendering policy in `src/core/statusline.ts` so the UI does not become a second formatter.

### Relevant Files

- `src/ui/StatusStrip.tsx` — choose the saved layout branch, read existing context, call the shared renderer, and preserve the legacy branch and containment styles.
- `src/ui/StatusStrip.test.tsx` — use existing in-memory strip helpers and no-overflow assertions for 80- and 64-column custom layouts.
- `src/ui/CockpitApp.tsx` — existing status-strip mount and shell-full-height behavior that remains an integration boundary.
- `src/ui/CockpitApp.test.tsx` — prove the footer stays bottom-pinned and reacts correctly to resize with both legacy and saved layouts.
- `src/store/selectors.ts` — provides the narrow saved-preference selector consumed by the strip.
- `src/app/controller.ts` — exposes existing runtime cwd and provider inputs without adding I/O.

### Dependent Files

- `src/core/statusline.ts` — owns all layout validation, omission, ellipsis, and segment rendering policy.
- `src/store/appStore.ts` — supplies the saved layout that toggles custom versus legacy rendering.
- `src/ui/StatuslineOverlay.tsx` — must display the same renderer output in its preview surface.

### Related ADRs

- [ADR-001: Constrain V1 to declarative conversational statusline configuration](adrs/adr-001.md) — requires the same safe renderer for preview and runtime output.
- [ADR-002: Make the statusline flow immediate, disclosed, and conversational-first](adrs/adr-002.md) — requires an approved change to become visible immediately.
- [ADR-003: Persist a structured statusline preference and share one pure renderer](adrs/adr-003.md) — defines null-layout legacy compatibility, grapheme ellipsis, and trailing omission.

## Deliverables

- A status strip that renders saved custom layouts through the pure renderer and preserves legacy output by default.
- Responsive one-line footer behavior across constrained widths and terminal resize.
- Direct strip and mounted cockpit regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for footer rendering and resize behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] A null saved layout preserves the prior legacy status-strip output, including workspace summary and the existing right-side hint.
  - [ ] A custom layout renders fields in its declared order and omits a missing branch or model without adjacent duplicated separators.
  - [ ] An `ELLIPSIS_BRANCH` item displays the core renderer's grapheme-safe shortened value rather than a UI-local truncation.
  - [ ] Custom layouts at 80 and 64 columns stay one line, contain no overflow sentinel, and omit trailing segments before display containment applies.
  - [ ] The shell-focused variant retains its shell-exit hint while custom left-side content changes.
- Integration tests:
  - [ ] A mounted cockpit with a saved custom layout remains bottom-pinned through a 100 → 64 → 120 column resize sequence, preserves no-overflow rendering, and leaves the legacy expectation unchanged when the layout is cleared.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- A confirmed saved layout is immediately visible through the same renderer used by the preview.
- Existing developers with no layout experience no footer regression at normal or narrow terminal widths.
