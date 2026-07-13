---
status: completed
title: "Add capability-gated tab keyboard navigation"
type: frontend
complexity: high
---

# Task 07: Add capability-gated tab keyboard navigation

## Overview

Enable the requested Ctrl+H and Ctrl+L navigation only when terminal input can distinguish those chords safely. The keyboard path must remain invisible on legacy terminals and never interfere with modal ownership or shell control-byte forwarding.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST request current OpenTUI Kitty keyboard disambiguation and alternate-key reporting at renderer creation without introducing terminal-name heuristics.
2. MUST keep an ephemeral `unknown | kittyConfirmed` capability state and promote it only after a valid Kitty-source event is observed.
3. MUST dispatch Ctrl+H/Ctrl+L tab navigation only when capability is confirmed, the current event source is Kitty, no overlay is open, and shell focus is absent.
4. MUST retain `/sessions` and attention routing as discoverable fallback behavior when direct chords are unavailable.
5. MUST preserve Ctrl+H and Ctrl+L forwarding as PTY bytes while the integrated shell owns focus.
</requirements>

## Subtasks
- [x] 7.1 Add renderer capability negotiation and injectable event observation.
- [x] 7.2 Record and expose ephemeral keyboard capability state.
- [x] 7.3 Register previous/next tab commands and conditional help in the canonical keymap.
- [x] 7.4 Preserve overlay, shell, and legacy-input precedence.
- [x] 7.5 Verify direct chords, fallback hints, and PTY bytes across terminal modes.

## Implementation Details

Follow the TechSpec’s **Keyboard Capability Policy** and **UI and Input Design** sections. Keep global matching, help text, and command dispatch centralized in `keymap.ts`; component-local keyboard listeners are out of scope.

### Relevant Files
- `src/index.ts` — renderer creation, injectable bootstrap, and key-input observation.
- `src/store/appStore.ts` — ephemeral keyboard capability storage.
- `src/ui/keymap.ts` — canonical command matching, uniqueness, and help data.
- `src/ui/keymap.test.ts` — matcher, discoverability, and legacy-input coverage.
- `src/ui/CockpitApp.tsx` — global input precedence and tab command dispatch.
- `src/ui/CockpitApp.test.tsx` — rendered modal suppression and shell-forwarding tests.
- `src/shell/keyEncoder.test.ts` — preserves Ctrl+H/Ctrl+L PTY encoding assertions.

### Dependent Files
- `test/index.integration.test.tsx` — renderer-option and lifecycle integration coverage.
- `test/keyEncoder.integration.test.ts` — event-to-PTY byte assertions.
- `src/shell/keyEncoder.ts` — existing control-byte boundary that must remain unchanged.
- `src/ui/StatusStrip.tsx` — conditional direct-chord versus fallback hint presentation.
- `src/ui/SessionsOverlay.tsx` — universal keyboard fallback destination.
- `src/ui/main.tsx` — render mounting seam if capability observation is injected there.

### Related ADRs
- [ADR-005: Gate Requested Tab Chords on Kitty Keyboard Events and Retain Sessions Fallback](adrs/adr-005.md) — requires persistent confirmation plus current Kitty-source input.

## Deliverables
- Renderer capability request, ephemeral capability promotion, and conditionally matched tab commands.
- Canonical keymap help/fallback behavior with shell and overlay safety.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests covering renderer configuration and exact PTY forwarding **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Unknown capability never navigates, including a first Kitty event before promotion is visible to dispatch.
  - [x] Confirmed capability plus Kitty Ctrl+H/Ctrl+L invokes exactly one previous/next action and prevents default.
  - [x] Confirmed capability plus a raw/legacy event, printable h/l, modified variants, and unrelated Kitty keys do not navigate.
  - [x] All overlay states suppress tab commands and conditional help exposes fallback text when unavailable.
  - [x] Shell-focused Ctrl+H/Ctrl+L produce the existing `0x08` and `0x0c` byte behavior with no tab action.
- Integration tests:
  - [x] Renderer bootstrap requests Kitty reporting while preserving current renderer options and cleanup behavior.
  - [x] Keyboard events traverse the mounted cockpit and shell runtime without chord leakage.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing.
- Test coverage >=80%.
- Requested chords work only when safe and never steal legacy editor or shell input.
- Keyboard fallback remains available and accurately advertised.
