---
status: completed
title: "Hand-off preview Shell context section"
type: frontend
complexity: medium
dependencies:
    - task_11
    - task_12
---

# Task 13: Hand-off preview Shell context section

## Overview
Let the developer curate shell context in the hand-off preview.
Add a droppable "Shell context" section that pre-fills with the snapshot's cwd and recent commands, lets the user drop any item with `Space` (the same gesture used for files and diffs), and records when a snapshot actually rides along.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST render a "Shell context" section in `HandoffPreview` showing cwd and the snapshot's command records when `bundle.shell` is present.
- MUST let the user highlight and drop individual commands with `Space`, updating `HandoffEdits.excludedCommands` by command id (drop by identity, not index).
- MUST include the section in the preview's navigation alongside files and diffs, reusing the existing `HANDOFF_KEYMAP` movement and toggle commands.
- MUST record `shell_snapshot_attached` when a hand-off is confirmed with at least one surviving command (via task_11's recorder).
- MUST show nothing shell-related when the bundle has no snapshot.
- SHOULD surface the redaction count so the developer sees that output was scrubbed.

## Subtasks
- [ ] 13.1 Render the "Shell context" section from `bundle.shell`
- [ ] 13.2 Wire `Space` to drop a highlighted command into `excludedCommands`
- [ ] 13.3 Integrate the section into the preview's item navigation
- [ ] 13.4 Emit `shell_snapshot_attached` on confirm with surviving commands
- [ ] 13.5 Hide the section when no snapshot is present

## Implementation Details
Modify `src/ui/HandoffPreview.tsx` and, if needed, the `HANDOFF_HINT` in `src/ui/keymap.ts`. Mirror the existing files/diffs section rendering and the keep/drop interaction. See TechSpec "Impact Analysis" and PRD "User Experience" (hand-off with shell context). The bundle/edits fields come from task_12; the recorder from task_11.

### Relevant Files
- `src/ui/HandoffPreview.tsx` — files/diffs section rendering and the keep/drop interaction to mirror
- `src/ui/keymap.ts` — `HANDOFF_KEYMAP` movement/toggle commands and `HANDOFF_HINT`
- `src/app/handoff.ts` — `HandoffEdits.excludedCommands` and confirm flow

### Dependent Files
- `src/telemetry/recorder.ts` — `shell_snapshot_attached` emission (task_11)

### Related ADRs
- [ADR-001: V1 Integrated Shell Is a Real PTY That Feeds the Hand-off](adrs/adr-001.md) — the human curation gate
- [ADR-002: Ship the Full Cockpit Shell in One Release, With Interactive-App Takeover in the MVP](adrs/adr-002.md) — snapshot attach is part of the MVP

## Deliverables
- A curatable "Shell context" section in the hand-off preview
- `shell_snapshot_attached` telemetry on confirm
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the curation flow **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] the section renders cwd and each command when `bundle.shell` is present
  - [ ] highlighting a command and pressing `Space` adds its id to `excludedCommands`
  - [ ] the section is absent when `bundle.shell` is undefined
  - [ ] confirming with at least one surviving command records `shell_snapshot_attached`
  - [ ] confirming after dropping every command records no snapshot event
- Integration tests:
  - [ ] navigate into the shell section, drop one command, confirm, and assert the sent prompt omits the dropped command but includes the rest and cwd
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Shell context is curatable with the same gesture as files and diffs
- Attaching a snapshot is recorded content-free
