---
status: completed
title: "Shell integration: OSC 133/OSC 7 command and cwd events"
type: backend
complexity: high
dependencies:
  - task_03
---

# Task 04: Shell integration: OSC 133/OSC 7 command and cwd events

## Overview
Make the shell's working state trustworthy by parsing shell-integration escape sequences.
Inject OSC 133 and OSC 7 hooks into the spawned shell and register emulator handlers that turn them into `command_started`, `command_finished` (with exit code), and `cwd_changed` events, so the hand-off snapshot carries real command boundaries, exit codes, and cwd rather than a guess.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST inject shell-integration setup for bash and zsh at spawn without editing the user's own dotfiles (a sourced snippet via an rc/ENV hook).
- MUST register OSC 133 handlers for prompt start, command start, and command finished-with-exit-code, and an OSC 7 handler for cwd, on the `@xterm/headless` instance.
- MUST translate those sequences into `command_started`, `command_finished`, and `cwd_changed` `ShellEvent`s emitted by the runtime.
- MUST capture each command's text and its output so the reducer's command record is populated.
- MUST degrade gracefully: a shell without integration still runs and renders, emitting no command/cwd events and falling back to raw scrollback.
- SHOULD detect an existing shell-integration setup and skip injecting a duplicate.

## Subtasks
- [x] 4.1 Author bash and zsh integration snippets emitting OSC 133/OSC 7
- [x] 4.2 Inject the correct snippet at shell spawn based on the shell
- [x] 4.3 Register emulator OSC handlers and map them to `ShellEvent`s
- [x] 4.4 Associate captured output with the open command record
- [x] 4.5 Verify graceful degradation when integration is absent

## Implementation Details
Add `src/shell/shellIntegration.ts` (snippet selection + OSC handler registration) and shipped snippet assets, wired into `ShellRuntime` from task_03. See TechSpec "Integration Points" for the OSC boundary and ADR-004 for the rationale and degradation contract. Do not redact here — output is stored raw and redacted only at hand-off assembly (task_12).

### Relevant Files
- `src/shell/shellRuntime.ts` — emitter of the events this task produces (task_03)
- `src/core/types.ts` — the `ShellEvent` shapes to emit (task_01)

### Dependent Files
- `src/core/shellReducer.ts` — consumes the command/cwd events (task_01)
- `src/core/bundleAssembler.ts` — the snapshot depends on populated command records (task_12)

### Related ADRs
- [ADR-004: Trustworthy Shell State via OSC 133 + OSC 7 Shell Integration](adrs/adr-004.md) — the mechanism and degradation contract

## Deliverables
- `src/shell/shellIntegration.ts` plus bash and zsh snippet assets
- OSC handlers emitting command/cwd events from the runtime
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests against a real shell **(REQUIRED)**

## Tests
- Unit tests (byte fixtures):
  - [x] an OSC 133 command-start then finished sequence with code `0` emits `command_started` then `command_finished` with `exitCode: 0`
  - [x] an OSC 133 finished sequence with code `1` emits `exitCode: 1`
  - [x] an OSC 7 `file://host/tmp` sequence emits `cwd_changed` with cwd `/tmp`
  - [x] output bytes between start and finish are captured into the command record
  - [x] a stream with no integration sequences emits no command/cwd events
- Integration tests (real shell):
  - [x] under bash with the snippet, `cd /tmp` then `false` yields `cwd_changed` `/tmp` and a record with `exitCode: 1`
  - [x] under zsh with the snippet, a successful command yields `exitCode: 0`
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Command boundaries, exit codes, and cwd are derived reliably under bash and zsh
- A shell without integration still runs and renders
