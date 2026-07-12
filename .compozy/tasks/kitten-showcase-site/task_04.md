---
status: pending
title: Add accessible install copy action handling
type: frontend
complexity: medium
---

# Task 04: Add accessible install copy action handling

## Overview

Add the runtime behavior that lets visitors copy the single verified install route reliably with accessible feedback. This improves conversion quality by reducing friction while preserving privacy and avoiding any tracking script behavior.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON WHAT — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST attach interactive copy behavior to the install command control and keep fallback path usable when Clipboard API is unavailable.
2. MUST announce copy success/failure via non-visual feedback (`aria-live`) for assistive technology users.
3. MUST avoid collecting, storing, or transmitting visitor identifiers while performing the copy action.
4. MUST preserve manual command readability for secure contexts where automatic copy fails.
5. SHOULD keep script loading and DOM attribute contracts minimal and explicit.
</requirements>

## Subtasks

- [ ] 04.01 Implement `site/src/scripts/copy-command.ts` with Clipboard API attempt and controlled fallback.
- [ ] 04.02 Add install button/trigger attributes in `site/src/components/Install.astro` to bind script behavior.
- [ ] 04.03 Add accessible status region for copy result messages and keyboard focus behavior.
- [ ] 04.04 Verify command source remains the single approved route from Task 02 and is not altered at runtime.
- [ ] 04.05 Add defensive handling for empty/invalid command inputs to prevent runtime errors.

## Implementation Details

This task realizes the "Verified Installation Conversion" implementation intent.

- `site/src/scripts/copy-command.ts`: client script that binds click/focus behavior and handles fallback path.
- `site/src/components/Install.astro`: command display + copy trigger + status live region.

### Relevant Files

- `site/src/scripts/copy-command.ts` — clipboard and fallback logic.
- `site/src/components/Install.astro` — command button semantics and accessibility hooks.

### Dependent Files

- `.compozy/tasks/kitten-showcase-site/task_03.md` — provides base component structure to enhance.
- `.compozy/tasks/kitten-showcase-site/task_06.md` — may refine focus and a11y styling for status messaging.

### Related ADRs

- [ADR-001: Build a Focused Proof-Led Astro Showcase](../adrs/adr-001.md) — conversion-first install behavior.
- [ADR-004: Defer site telemetry collection until post-launch](../adrs/adr-004.md) — ensures no behavioral tracking in copy flow.

## Deliverables

- Fully interactive copy action for the primary install command.
- Accessible copy state messaging in markup.
- Unit test for command fallback detection and status messaging model (if harness is added in this feature path).
- Integration smoke for successful copy workflow and secure-context fallback path.
- Unit test coverage target: >=80% for copy-script logic.

## Tests

- Unit tests:
  - [ ] Copy handler copies exact command text when Clipboard API succeeds.
  - [ ] Fallback path selects content and updates status text when Clipboard API is unavailable.
  - [ ] Empty/invalid command input does not emit a false success state.
- Integration tests:
  - [ ] Keyboard users can tab to copy control and trigger via Enter/Space.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80% for copy script logic
- Copy flow works with and without Clipboard API support
- Copy action does not perform telemetry or data submission
