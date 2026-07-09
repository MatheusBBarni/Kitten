---
status: pending
title: "Key-to-VT input encoder"
type: backend
complexity: low
dependencies: []
---

# Task 07: Key-to-VT input encoder

## Overview
Translate OpenTUI key events into the byte sequences a real terminal expects, so keystrokes forwarded to the shell behave correctly.
This is a pure, table-driven function covering printables, control chords, arrows, and function keys, kept separate so it is exhaustively unit-testable before it is wired into input forwarding.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST implement a pure `encodeKey(key)` in `src/shell/keyEncoder.ts` returning the terminal byte sequence for a key event, or nothing for a key it does not translate.
- MUST cover printable characters, Enter/Tab/Backspace, arrows, Home/End/PageUp/PageDown, common Ctrl combinations (including `Ctrl+C` as `0x03`), and function keys F1-F12.
- MUST accept a structural key type (like `CockpitKey`) rather than importing OpenTUI's `KeyEvent`, keeping the function trivially testable.
- MUST be pure: no I/O, no PTY reference, deterministic per input.
- SHOULD encode the standard xterm sequences so `@xterm/headless`-hosted apps interpret them correctly.

## Subtasks
- [ ] 7.1 Define the input key shape the encoder accepts
- [ ] 7.2 Encode printables, Enter, Tab, and Backspace
- [ ] 7.3 Encode arrows, navigation keys, and function keys
- [ ] 7.4 Encode Ctrl combinations, including `Ctrl+C`
- [ ] 7.5 Return nothing for unmapped keys

## Implementation Details
Create `src/shell/keyEncoder.ts`. Model the key input structurally like `CockpitKey` in `src/ui/keymap.ts`. See TechSpec "System Architecture" (input routing) and ADR-005 for where the encoder sits in the input path. Wiring into the pane is task_09.

### Relevant Files
- `src/ui/keymap.ts` — `CockpitKey` shape to mirror for the input type
- `src/shell/shellRuntime.ts` — consumes encoded bytes via `write` (task_03)

### Dependent Files
- `src/ui/CockpitApp.tsx` / `src/ui/ShellPane.tsx` — forward encoded keys to the runtime (task_09)

### Related ADRs
- [ADR-005: In-Pane Interactive Apps, Pane Focus, and Ctrl+C Routing](adrs/adr-005.md) — input routing to the PTY

## Deliverables
- Pure `encodeKey` in `src/shell/keyEncoder.ts`
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for a representative key sequence **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] a printable `a` encodes to the byte `0x61`
  - [ ] `Enter` encodes to `\r` (`0x0d`)
  - [ ] `Ctrl+C` encodes to `0x03`
  - [ ] `ArrowUp` encodes to the `ESC [ A` sequence
  - [ ] `F1` encodes to its standard sequence
  - [ ] an unmapped key returns nothing
- Integration tests:
  - [ ] a typed line "ls\r" encodes to the exact byte sequence a shell would receive
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The encoder is pure and covers the key classes interactive apps need
- `Ctrl+C` encodes to `0x03`
