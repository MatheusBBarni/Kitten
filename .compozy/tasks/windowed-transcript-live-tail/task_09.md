---
status: completed
title: Register Canonical History Commands
type: frontend
complexity: medium
---

# Task 09: Register Canonical History Commands

## Overview

Expose earlier-history loading and return-to-live through Kitten's existing slash-command registry, shared dispatcher, help, and composer discovery. The commands target only the focused session's transient state and never send a prompt or introduce a global chord.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add distinct semantic intents mapped exactly to /history and /latest through CockpitCommand and COCKPIT_COMMANDS.
2. MUST dispatch both intents only through CockpitApp's existing shared runCockpitCommand path to task 02 store actions for the focused session.
3. MUST preserve registry-derived help and slash-menu discovery, including exact-draft and menu activation behavior.
4. MUST add no global key chord, Settings control, marker UI, projection calculation, agent prompt dispatch, config change, or telemetry change.
5. MUST treat missing focused sessions or inert/disabled state as safe no-ops delegated to task 02 actions.
</requirements>

## Subtasks

- [ ] Add /history and /latest intents and concise registry descriptions.
- [ ] Keep help and slash-menu labels derived from the central registry.
- [ ] Dispatch both intents through the shared CockpitApp command switch.
- [ ] Cover exact draft and menu activation without agent prompt sends.
- [ ] Verify focused-session targeting and no-global-chord policy.

## Implementation Details

Modify src/ui/keymap.ts, src/ui/keymap.test.ts, src/ui/CockpitApp.tsx, src/ui/CockpitApp.test.tsx, src/ui/PromptEditor.tsx only if typed adaptation is required, and src/ui/PromptEditor.test.tsx. Follow the TechSpec Integration Points; src/ui/SlashMenu.tsx is a read-only generic dependent.

### Relevant Files

- src/ui/keymap.ts — CockpitCommand union, registry, help derivation, and slash labels.
- src/ui/keymap.test.ts — registry, uniqueness, help, and global-key regression tests.
- src/ui/CockpitApp.tsx — shared command dispatch.
- src/ui/CockpitApp.test.tsx — focused-session command integration.
- src/ui/PromptEditor.tsx — registry-driven draft and menu resolution.
- src/ui/PromptEditor.test.tsx — composer discovery/submission coverage.
- src/ui/SlashMenu.tsx — read-only generic command-row consumer.

### Dependent Files

- src/store/appStore.ts — task 02 history actions.
- src/store/selectors.ts — task 02 focused-session state.
- src/ui/ConversationView.tsx — task 08 marker and return-to-live behavior.

### Related ADRs

- [ADR-002: Launch bounded live history as a truth-first experiment](adrs/adr-002.md) — Requires explicit reveal UX.
- [ADR-003: Separate transcript projection from semantic session state](adrs/adr-003.md) — Keeps state ownership outside CockpitApp.
- [ADR-004: Use strict config, canonical commands, and bounded evidence](adrs/adr-004.md) — Requires canonical commands and forbids a global chord.

## Deliverables

- Registered /history and /latest commands with focused-session dispatch.
- Registry/help/composer/cockpit regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Command-to-store integration tests **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Registry tuple contains unique canonical history/latest names and semantic intents.
  - [ ] Help contains both derived slash labels and the global keymap remains unchanged.
  - [ ] Exact /history and /latest drafts resolve while arguments and agent commands remain unclaimed.
  - [ ] Slash menu shows both entries and each activation calls onRunCommand once without sendPrompt.
- Integration tests:
  - [ ] Cockpit command targets the focused session only, changes reveal/return state, and sends no prompt.
  - [ ] Focus switching before dispatch targets the newly focused session.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Both commands are discoverable through existing help and slash paths.
- No new global key binding or agent prompt path is introduced.
