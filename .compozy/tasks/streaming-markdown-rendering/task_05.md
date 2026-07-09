---
status: pending
title: "File-row provenance links for the hand-off preview"
type: frontend
complexity: medium
dependencies:
  - task_04
---

# Task 05: File-row provenance links for the hand-off preview

## Overview
Provenance in the review console rides on the already-structured referenced-files list rather than fragile inline links in the prose.
This task makes each referenced-file row a provenance affordance: a clickable OSC 8 `file://` link where the terminal supports it, degrading to plain readable path text otherwise.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST render each referenced-file row as an OSC 8 `file://` link to its path when the terminal advertises hyperlink support, and as plain path text otherwise (graceful fallback).
- MUST keep the existing keep/drop `[x]`/`[ ]` semantics, the highlight marker, and the `(reason)` suffix intact.
- MUST NOT introduce inline links into the summary prose or heuristic path-matching against summary text.
- MUST NOT change the diff rows or the summary rendering.
- MUST isolate the link-versus-text decision in a small pure helper so it is unit-testable without inspecting rendered escape sequences.
</requirements>

## Subtasks
- [ ] 5.1 Read the terminal's advertised hyperlink capability.
- [ ] 5.2 Add a pure helper that maps a file path plus capability to either a `file://` link target or plain text.
- [ ] 5.3 Render file rows as links when supported and plain text otherwise, preserving keep/drop, highlight, and reason.
- [ ] 5.4 Add tests for the helper and for both rendered paths.

## Implementation Details
Modify `src/ui/HandoffPreview.tsx` (`ItemRow` and the files section) to attach the link when supported, reading the renderer's advertised hyperlink capability.
OSC 8 emission is native in OpenTUI, so the row only attaches the link target; Kitten does not emit escape bytes itself.
Because the test harness's captured spans do not expose link metadata, the link-versus-text choice lives in a pure helper that is unit-tested directly.
See TechSpec "Integration Points" (Terminal OSC 8) and ADR-005.

### Relevant Files
- `src/ui/HandoffPreview.tsx` - `ItemRow`, the files section, and `usePalette`.
- `src/core/types.ts` - `HandoffBundle.files` (path plus `read`/`edited` reason).
- `src/ui/HandoffPreview.test.tsx` - the preview harness for the rendered-path assertions.

### Dependent Files
- None beyond the preview.

### Related ADRs
- [ADR-005: Provenance via the Structured Referenced-Files List](../adrs/adr-005.md) - the decision this task implements.

## Deliverables
- Referenced-file rows render as provenance links where supported and readable path text otherwise, via a pure link-decision helper.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration coverage that referenced files appear as provenance rows in the full preview **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] The link-decision helper returns a `file://` target for a path when hyperlinks are supported.
  - [ ] The helper returns no link (plain path text) when hyperlinks are unsupported.
  - [ ] Keep/drop toggling still flips `[x]`/`[ ]` and the row color, and the `(read)`/`(edited)` reason suffix is preserved.
  - [ ] A file row renders its path text in both supported and unsupported modes (path visible in `captureCharFrame`).
- Integration tests:
  - [ ] In the full preview, a referenced file appears as a provenance row alongside the rendered summary.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Referenced-file rows are navigable provenance where supported and readable text otherwise.
- No inline prose links or heuristic path-matching are introduced.
