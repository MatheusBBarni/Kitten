---
status: completed
title: "Session-addressed hand-off"
type: backend
complexity: high
dependencies:
  - task_01
  - task_05
---

# Task 06: Session-addressed hand-off

## Overview
Re-address the curated hand-off from "the agent that is not focused" to a target session the developer explicitly chooses, so the hand-off works across a fleet rather than only between two fixed agents.
Curation, redaction, and the composed bundle stay exactly as they are today; only the choice of recipient changes, and a characterization test guards the moat against regression.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST change `HandoffPreviewOverlay` to carry `sourceSessionId` and `targetSessionId` instead of the two agent ids, per the TechSpec "Data Models" section.
- MUST add a target-selection step before the preview that lets the developer pick the recipient session, reusing the task_05 overview selection, replacing the `nextAgentId` targeting in `handoff.begin`.
- MUST leave bundle assembly, curation (keep/drop), redaction, and `composeHandoffBlocks` unchanged, guarded by a characterization test, per ADR-002.
- MUST send the curated bundle to the chosen target session and move focus to it on confirm.
- MUST NOT open a target picker when fewer than two ready sessions exist or when an overlay is already open.
</requirements>

## Subtasks
- [x] 6.1 Change the preview overlay to carry source and target `SessionId`.
- [x] 6.2 Add the target-selection step reusing the overview selection.
- [x] 6.3 Replace `nextAgentId` targeting in `begin` with the chosen target session.
- [x] 6.4 Send to the chosen target and move focus on confirm.
- [x] 6.5 Add a characterization test locking curation, redaction, and the composed blocks.

## Implementation Details
Follow the TechSpec "Actions and Events" section: the hand-off keeps `begin`/`confirm`/`cancel`, but `begin` now resolves a target session through the picker instead of `nextAgentId`.
The assembler, `composeHandoffBlocks`, and the redaction path are untouched; the change is confined to targeting and the overlay shape.

### Relevant Files
- `src/app/handoff.ts` - `begin`/`confirm` targeting moves from `nextAgentId` to the chosen session.
- `src/store/appStore.ts` - `HandoffPreviewOverlay` gains `sourceSessionId`/`targetSessionId`.
- `src/app/actions.ts` - `switchFocus` and hand-off send resolve by `SessionId`.
- `src/ui/HandoffPreview.tsx` - shows the chosen target session.
- `src/ui/SessionsOverlay.tsx` - reused as the target picker (task_05).

### Dependent Files
- `src/telemetry/recorder.ts` - the hand-off metrics still fire from the flow (task_09 unaffected).

### Related ADRs
- [ADR-002: Ship the Full Attention Cockpit as a Single V1](../adrs/adr-002.md) - the hand-off must land on the session model in the same release without regressing.
- [ADR-004: N-Session Identity Model](../adrs/adr-004.md) - source and target are session ids.

## Deliverables
- Hand-off retargeted to a developer-chosen session with unchanged curation and redaction.
- A target-selection step reusing the overview.
- A characterization test guarding the composed bundle and redaction.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests covering hand-off and hand-back across three sessions **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] `begin` returns false when only one session is ready (no recipient) and when an overlay is already open.
  - [ ] Selecting a target routes `confirm` to that session's `sendPrompt` and moves focus to it.
  - [ ] `composeHandoffBlocks` output is byte-for-byte unchanged for a fixed bundle and edits (characterization).
  - [ ] The bundle's `redactionCount` is preserved through the re-addressed flow.
- Integration tests:
  - [ ] With three sessions, hand off from session A, pick session C as target, and assert the bundle prompt lands in C and focus moves to C; then hand back from C to A successfully.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Hand-off targets an explicitly chosen session and hand-back still works
- Curation and redaction behavior is provably unchanged
