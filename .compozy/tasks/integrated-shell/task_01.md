---
status: completed
title: "Shell domain types and reducer"
type: backend
complexity: medium
dependencies: []
---

# Task 01: Shell domain types and reducer

## Overview
Add the protocol-free domain model for the shell and the pure reducer that writes it.
This is the stable core every later shell task builds on: the `ShellState` slice shape, the `ShellEvent` union, the `ShellSnapshot` used by the hand-off, and a `shellReducer` that folds events into state with no I/O, mirroring the existing `sessionReducer`.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `ShellCommandRecord`, `ShellState`, `ShellSnapshot`, and the `ShellEvent` union to `src/core/types.ts`, matching the TechSpec "Data Models" section.
- MUST implement a pure `shellReducer(state, event)` in a new `src/core/shellReducer.ts` that returns a new state and never mutates its input, imports no I/O or ACP SDK, mirroring `sessionReducer`.
- MUST bound the `commands` ring to a fixed maximum length, dropping the oldest record when the cap is exceeded.
- MUST close the open command record with its exit code on `command_finished` and set `status` to `idle`, and open a new record and set `status` to `running` on `command_started`.
- MUST update `cwd` on `cwd_changed` and bump `renderRev` on `screen` without touching command records.
- SHOULD provide a `createShellState()` factory returning an empty, idle initial state.
</requirements>

## Subtasks
- [x] 1.1 Define the shell data-model types in `src/core/types.ts`
- [x] 1.2 Implement `createShellState` and the pure `shellReducer`
- [x] 1.3 Apply command open/close, cwd, and screen-revision transitions
- [x] 1.4 Enforce the bounded command ring
- [x] 1.5 Add an exhaustiveness guard so an unhandled event kind is a compile error

## Implementation Details
Add types to `src/core/types.ts` and create `src/core/shellReducer.ts`. Follow the exact patterns in `src/core/sessionReducer.ts`: immutable updates, an `assertNever` exhaustiveness guard, and a `create*State` factory. See TechSpec "Data Models" for the type shapes and "System Architecture" for where the reducer sits in the layering.

### Relevant Files
- `src/core/types.ts` — home of the shell types alongside `SessionState` and `HandoffBundle`
- `src/core/sessionReducer.ts` — the reducer pattern to mirror (immutability, `assertNever`, factory)
- `src/core/sessionReducer.test.ts` — the fixture-driven test style to follow

### Dependent Files
- `src/store/appStore.ts` — will hold the `shell` slice (task_02)
- `src/shell/shellRuntime.ts` — will emit `ShellEvent`s (task_03)
- `src/core/bundleAssembler.ts` — will read `ShellSnapshot` (task_12)

### Related ADRs
- [ADR-003: Shell Runtime and Rendering Architecture](adrs/adr-003.md) — mandates a pure semantic slice separate from render state

## Deliverables
- Shell types in `src/core/types.ts` and a pure `shellReducer` in `src/core/shellReducer.ts`
- `createShellState` factory
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for reducer event-sequence folding **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `createShellState` returns status `idle`, empty commands, empty cwd, renderRev 0
  - [x] `command_started` opens a record with `exitCode: null` and sets status `running`
  - [x] `command_finished` sets the matching record's `exitCode` and returns status `idle`
  - [x] `cwd_changed` updates cwd and leaves commands untouched
  - [x] `screen` bumps `renderRev` and touches nothing else
  - [x] the command ring drops the oldest record once the cap is exceeded
  - [x] the reducer returns a new object and does not mutate the input state
- Integration tests:
  - [x] folding a realistic sequence (start, finish, cd, start, finish) yields the expected cwd and two closed records with correct exit codes
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Shell types compile and are exported from `src/core/types.ts`
- `shellReducer` is pure: no imports from `src/agent`, no I/O
