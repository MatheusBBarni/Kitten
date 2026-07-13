---
status: completed
title: "Handoff-preview target headroom line"
type: frontend
complexity: medium
dependencies:
  - task_04
  - task_05
---

# Task 07: Handoff-preview target headroom line

## Overview
Show the target agent's headroom on a line in the `Ctrl+T` handoff preview, just after the redaction notice, so the room the task is landing in is visible at the moment of decision.
The line reads "unknown" honestly when the target agent reports nothing.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a single target-headroom line to the handoff preview immediately after the redaction notice and before the Summary heading, reading `selectSessionHeadroom(targetSessionId)`.
- MUST render `HEADROOM_UNKNOWN` when the target agent has no usage (never a fabricated number).
- MUST use a neutral treatment consistent with the strip, reusing `formatHeadroom` and existing palette tokens.
- MUST keep the height-bounded dialog within the test terminal row budget so the send hint and action stay visible.
- MUST memoize the target selector on `targetSessionId`.
</requirements>

## Subtasks
- [x] 7.1 Add a memoized target-headroom selector to the handoff dialog.
- [x] 7.2 Render the target-headroom line after the redaction notice.
- [x] 7.3 Render the unknown marker when the target has no usage.
- [x] 7.4 Add preview frame tests for known and unknown target headroom and the row budget.

## Implementation Details
Modify `src/ui/HandoffPreview.tsx`: the target agent is already resolved for the dialog title; insert a `<text>` line after the redaction notice and before the Summary heading, reading the target's headroom via a memoized selector and formatting it with `formatHeadroom`.
Consumes `selectSessionHeadroom` (task_04) and `formatHeadroom` (task_05). See TechSpec "System Architecture" (UI surfaces).

### Relevant Files
- `src/ui/HandoffPreview.tsx` — the target-name resolution and the redaction-notice header area where the line attaches.

### Dependent Files
- `src/ui/HandoffPreview.test.tsx` — open-preview-through-shell test; add target-headroom assertions and a row-budget check.

### Related ADRs
- [ADR-001: Ambient per-agent headroom gauge](../adrs/adr-001.md) — headroom at the handoff decision moment.
- [ADR-002: Validation-gated honest MVP](../adrs/adr-002.md) — neutral, honest unknown.
- [ADR-003: Headroom derivation](../adrs/adr-003.md) — reuse the same selector and formatter.

## Deliverables
- A target-headroom line in the handoff preview.
- Preview frame tests.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration (frame) tests for the preview **(REQUIRED)**

## Tests
- Unit tests:
  - [x] The preview composes the target headroom line via `formatHeadroom` from the target's selector value.
- Integration tests:
  - [x] Opening the preview when the target (Codex) has usage `{ used: 36000, size: 200000 }` shows a target-headroom line reading `82%`.
  - [x] Opening the preview when the target has no usage shows `—` on that line.
  - [x] After adding the line, the dialog still fits a 24-row terminal with the send hint and action visible.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Target headroom is shown at the handoff decision moment
- The unknown marker is shown honestly when the target reports nothing
- The dialog fits the test terminal row budget
