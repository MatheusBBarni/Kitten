---
status: pending
title: "Hand-off shell snapshot assembly"
type: backend
complexity: medium
dependencies:
  - task_01
  - task_04
  - task_05
---

# Task 12: Hand-off shell snapshot assembly

## Overview
Wire the shell into the hand-off so the receiving agent inherits the working state.
Add an optional `shell` snapshot to the hand-off bundle, populate it from the shell slice, redact command output with the existing redactor, exclude environment variables, and compose it into the prompt block the target agent reads.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add optional `shell?: ShellSnapshot` to `HandoffBundle` and `excludedCommands: ReadonlySet<string>` to `HandoffEdits`, with `includedCommands` filtering helper.
- MUST populate `bundle.shell` in the deterministic assembler from the shell slice's cwd and recent command records, redacting each command's output via the existing `secretRedactor` and adding to `redactionCount`.
- MUST never include environment variables in the snapshot.
- MUST compose a "Shell context" prompt block in `composeHandoffBlocks` from the surviving (non-excluded) commands and cwd.
- MUST leave the snapshot attach opt-in and curated: nothing shell-related is auto-sent without passing the preview (task_13).
- SHOULD produce no shell block when the shell slice is empty or the developer drops every command.

## Subtasks
- [ ] 12.1 Add the `shell` bundle field and `excludedCommands` edits field with an `includedCommands` helper
- [ ] 12.2 Populate and redact the snapshot in the deterministic assembler
- [ ] 12.3 Compose the "Shell context" prompt block from surviving commands and cwd
- [ ] 12.4 Read the shell slice at `begin()` and pass it to the assembler
- [ ] 12.5 Ensure env is never present in the snapshot

## Implementation Details
Modify `src/core/types.ts`, `src/core/bundleAssembler.ts`, and `src/app/handoff.ts`. Follow the assembler's existing redact-as-you-build approach (`redactDiffs`, `renderTurn`) and `composeHandoffBlocks`'s per-part block pattern. See TechSpec "Data Models" (hand-off additions) and ADR-001. Reuse `createSecretRedactor().redact()` unchanged.

### Relevant Files
- `src/core/bundleAssembler.ts` — `assemble`, `redactDiffs`, and the redaction call pattern to mirror
- `src/app/handoff.ts` — `HandoffEdits`, `includedFiles`/`includedDiffs`, `composeHandoffBlocks`, `begin()`
- `src/core/secretRedactor.ts` — reused unchanged on command output
- `src/core/types.ts` — `HandoffBundle` and `ShellSnapshot`

### Dependent Files
- `src/ui/HandoffPreview.tsx` — renders and curates the shell section (task_13)

### Related ADRs
- [ADR-001: V1 Integrated Shell Is a Real PTY That Feeds the Hand-off](adrs/adr-001.md) — snapshot content, redaction, env exclusion

## Deliverables
- `shell` bundle field, `excludedCommands` edits field, and the compose block
- Redacted, env-free snapshot assembly
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for compose output **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] the assembler populates `bundle.shell` with cwd and recent command records
  - [ ] a command whose output contains a token is redacted and `redactionCount` increases
  - [ ] no environment-variable data appears in the snapshot
  - [ ] `composeHandoffBlocks` emits a "Shell context" block from surviving commands
  - [ ] dropping every command via `excludedCommands` omits the shell block
- Integration tests:
  - [ ] a full assemble-then-compose over a shell slice yields a prompt block containing cwd and the redacted commands
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The hand-off can carry a redacted, env-free shell snapshot
- Nothing shell-related is sent without curation
