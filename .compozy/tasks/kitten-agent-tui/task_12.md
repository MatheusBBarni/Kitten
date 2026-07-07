---
status: pending
title: "Hand-off and hand-back flow"
type: frontend
complexity: high
dependencies:
  - task_06
  - task_07
  - task_08
---

# Task 12: Hand-off and hand-back flow

## Overview
Implement the product's core interaction: a one-keystroke hand-off that assembles the bundle, redacts secrets, opens an editable preview, and on confirm sends it to the other agent and switches focus.
The same mechanism works in both directions, so a task can be handed off and later handed back within a run.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST trigger on a single keystroke that assembles a `continue` hand-off bundle from the focused agent's session using the deterministic assembler (task_06).
- MUST redact secrets before the bundle is displayed and show the redaction count.
- MUST open an editable `HandoffPreview` overlay where the user can trim the summary, drop turns/files, and adjust pending diffs before sending.
- MUST, on confirm, compose the bundle into prompt blocks and send it to the target agent via the controller's `sendPrompt`, then switch focus to the target.
- MUST support both directions (hand-off and hand-back) using the same flow.
- MUST render the preview as a conditional absolute overlay (no Portal) per ADR-004, and never auto-send without the preview.
</requirements>

## Subtasks
- [ ] 12.1 Bind the hand-off keystroke to assemble and redact a bundle from the focused session
- [ ] 12.2 Open the editable `HandoffPreview` overlay showing summary, files, diffs, and redaction count
- [ ] 12.3 Allow the user to edit/trim the bundle before sending
- [ ] 12.4 On confirm, compose prompt blocks, send to the target via `sendPrompt`, and switch focus
- [ ] 12.5 Make the flow symmetric so hand-back works from either agent
- [ ] 12.6 Cover assembly-to-send and edit/cancel paths with tests

## Implementation Details
Create the hand-off orchestration and preview overlay. See TechSpec "System Architecture → Data flow" (hand-off path), ADR-002 (human-curated deterministic bundle), and PRD F3/F4. Uses the assembler/redactor (task_06), the controller's `sendPrompt` and focus (task_07), and mounts over the shell (task_08).

### Relevant Files
- `src/app/handoff.ts` — new; orchestrates assemble → redact → send
- `src/ui/HandoffPreview.tsx` — new; the editable preview overlay
- `src/app/handoff.test.ts`, `src/ui/HandoffPreview.test.tsx` — new; tests

### Dependent Files
- `src/ui/CockpitApp.tsx` (task_08) — mounts the preview and binds the keystroke
- `src/telemetry/recorder.ts` (task_13) — records hand-off events emitted here

### Related ADRs
- [ADR-002: Validation-First Thin Slice for V1](adrs/adr-002.md) — deterministic, human-curated hand-off; preview before send
- [ADR-003: Layered Architecture with an ACP Anti-Corruption Layer](adrs/adr-003.md) — assembly in the pure core, send through the controller

## Deliverables
- End-to-end hand-off and hand-back flow with an editable preview
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test of assemble → preview → edit → send → focus-switch **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] The hand-off keystroke assembles a bundle from the focused session and opens the preview with a redaction count
  - [ ] Editing the preview to drop a file removes it from the composed prompt blocks
  - [ ] Confirming sends the composed bundle to the target agent via `sendPrompt` and switches focus to the target
  - [ ] Cancelling the preview sends nothing and leaves focus unchanged
  - [ ] A hand-back from the target agent uses the same flow toward the original agent
- Integration tests:
  - [ ] Against two mock connections, assemble → edit → confirm delivers the bundle to the target and focus moves, with no auto-send bypassing the preview
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A single keystroke produces an editable, secret-redacted bundle that only sends on confirm
- Hand-off and hand-back both work within a run
