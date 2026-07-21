---
status: completed
title: Supply focused-session CONTEXT to the saved footer
type: frontend
complexity: medium
---

# Task 03: Supply focused-session CONTEXT to the saved footer

## Overview

Connect the saved custom footer to the current focused session's validated headroom. The UI must pass that raw nullable value into the canonical statusline context, so rendering, omission, and width policy remain owned by the shared core contract.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. `CustomStatusline` MUST memoize `selectSessionHeadroom(sessionId)` and subscribe with `useAppSelector`, then pass the raw `number | null` value as `contextHeadroom` to `StatuslineContext`.
2. A saved layout containing `CONTEXT` MUST follow the current focused session after a conversation selection and MUST NOT retain a previous session's value.
3. Missing or selector-invalid usage MUST use canonical context omission: no placeholder, fabricated `0%`, duplicate separators, or UI-specific formatting.
4. The saved footer MUST continue using `renderStatusline` and `statuslineFooterBudget`, including natural trailing `CONTEXT` removal at narrow widths.
5. The `statusline.layout === null` legacy branch and `AgentStatusChip` behavior MUST remain unchanged; this task MUST NOT change config, persistence, ACP, reducer, or telemetry behavior.
</requirements>

## Subtasks

1. Subscribe the saved custom-footer renderer to the focused session's validated headroom.
2. Include the nullable headroom in the memoized canonical statusline context.
3. Test focused-session changes, unavailable values, and valid saved `CONTEXT` rendering.
4. Test canonical narrow-width context removal in the saved footer.
5. Preserve and regression-test the no-custom-layout legacy footer path.

## Implementation Details

### Relevant Files

- `src/ui/StatusStrip.tsx` — supply focused-session headroom to `CustomStatusline`.
- `src/ui/StatusStrip.test.tsx` — colocated saved-footer and legacy-path regression coverage.

### Dependent Files

- `src/store/selectors.ts` — nullable per-session validity boundary.
- `src/core/statusline.ts` — canonical context formatting and budgeting.
- `test/fakeController.ts` — existing test controller infrastructure; no changes expected.
- `src/ui/cockpitContext.tsx` — existing narrow-selector test infrastructure; no changes expected.

### Related ADRs

- [ADR-001: Statusline Context Headroom Field](/Users/matheusbbarni/projects/kitten/.compozy/tasks/statusline-context-field/adrs/adr-001.md)
- [ADR-002: Context Proposal and Persistence Contract](/Users/matheusbbarni/projects/kitten/.compozy/tasks/statusline-context-field/adrs/adr-002.md)
- [ADR-003: Shared Selector Validity and Context Ownership](/Users/matheusbbarni/projects/kitten/.compozy/tasks/statusline-context-field/adrs/adr-003.md)

## Deliverables

- A saved custom-footer context that receives validated headroom for the focused session.
- Colocated UI tests for valid rendering, focus ownership, canonical omission, narrow widths, and the unchanged legacy footer.
- Targeted coverage at or above 80% for the changed saved-footer behavior.

## Tests

### Unit Tests

- Render a saved `[CONTEXT]` layout with `124_000 / 200_000` usage and assert `ctx 38%`.
- Switch focus between sessions with distinct valid values and assert the footer shows only the newly focused session's value.
- Render unavailable and out-of-range usage with `[PROVIDER, CONTEXT, FOLDER]` and assert no context, `0%`, or duplicate ` · ` separator.
- Resize a `[FULL_PATH, CONTEXT]` footer to a narrow width and assert the path remains while trailing context drops.

### Integration Tests

- Use the existing fake-controller and real-store path to change the focused conversation while the saved custom footer is mounted.
- With `layout: null` and valid usage, assert the existing legacy `AgentStatusChip` path remains the renderer rather than `CustomStatusline`.

## Success Criteria

- Saved custom layouts derive `CONTEXT` exclusively from the current focused session.
- Rendering delegates all formatting, omission, and budgeting to canonical core behavior.
- The legacy footer stays unchanged and all changed tests pass with at least 80% coverage for the implemented behavior.
