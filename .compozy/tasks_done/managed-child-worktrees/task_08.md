---
status: completed
title: Add terminal worktree review and cleanup routing
type: frontend
complexity: high
---

# Task 08: Add terminal worktree review and cleanup routing

## Overview

Add detailed terminal managed-worktree review and explicit cleanup confirmation to the Sessions modal. The interaction must stay contextual to a captured child, preserve existing close behavior, and use only selector-projected facts plus the controller action boundary.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST expose detailed review only for terminal managed-child presentations supplied by selectors.
2. MUST capture the reviewed child id locally and route cleanup only to that target after explicit confirmation.
3. MUST render labeled branch, path, base, availability, and bounded refusal state without raw binding or Git reads.
4. MUST keep review and cleanup keys modal-local, fail-safe, duplicate-resistant, and separate from session close or global commands.
5. MUST preserve safe modal preemption and return to a reviewable state after bounded cleanup outcomes.
</requirements>

## Subtasks
- [x] Add selector-presentation-driven terminal review eligibility.
- [x] Add local captured review and cleanup-confirmation modes.
- [x] Add contextual modal commands and accurate key hints.
- [x] Route confirmed cleanup through the controller action only.
- [x] Extend fake-controller behavior and mounted modal/keymap coverage.

## Implementation Details

Use the Sessions modal as the detailed review surface from the TechSpec UI section. Keep the existing `d` close workflow unchanged and do not create a global slash command or new store overlay.

### Relevant Files
- `src/ui/SessionsOverlay.tsx` — session card rendering, captured target routing, and modal input.
- `src/ui/SessionsOverlay.test.tsx` — mounted review, close, preemption, and input tests.
- `src/ui/keymap.ts` — sessions-modal intents, matching, and hints.
- `src/ui/keymap.test.ts` — matcher, uniqueness, modifier, and hint coverage.
- `test/fakeController.ts` — configurable cleanup action recording for mounted UI tests.
- `test/fakeController.test.ts` — fake action behavior where coverage exists.

### Dependent Files
- `src/ui/TabDialog.tsx` — remains the ordinary captured-close reference and must not gain cleanup behavior.
- `src/telemetry/recorder.ts` — later records accepted controller outcomes only.

### Related ADRs
- [ADR-002: Make in-Kitten review the primary completion loop](adrs/adr-002.md) — terminal review policy.
- [ADR-005: Restrict cleanup to terminal child review](adrs/adr-005.md) — contextual confirmation boundary.

## Deliverables
- Detailed terminal review and contextual cleanup confirmation in Sessions.
- Mounted modal and keymap tests with >=80% coverage **(REQUIRED)**.
- Integration coverage for captured target, refusal, and modal-preemption safety **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Terminal managed review shows labeled provenance and availability; ordinary or active rows expose no cleanup.
  - [x] Review then confirmation sends zero actions before Enter; Esc preserves the artifact.
  - [x] Pending confirmation blocks duplicate cleanup and preserves the captured child id despite focus changes.
  - [x] Existing `d` command still opens ordinary captured close, never cleanup.
- Integration tests:
  - [x] Refused/removed outcomes stay contextual and approval/clarification preemption cannot fire cleanup beneath the higher-priority modal.
  - [x] Review/confirmation shortcuts do not leak to PromptEditor, shell, or global help.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Cleanup can be invoked only for the explicitly reviewed terminal child.
- No cleanup key or confirmation can mutate an unrelated session.
