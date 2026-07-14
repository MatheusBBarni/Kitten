---
status: completed
title: "Apply defaults after explicit /model selection and render picker feedback"
type: frontend
complexity: medium
---

# Task 7: Apply defaults after explicit /model selection and render picker feedback

## Overview

Extend the existing /model tab flow so an explicit switch to a different provider session invokes one controller-owned default action. Render compact session-scoped applied, partial, or unavailable feedback while model and effort rows continue to derive only from confirmed options.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. Only a different explicit /model tab/session selection MUST invoke applyProviderDefaults.
- 2. Opening picker, passive focus, reload, Escape, and manual row changes MUST NOT invoke it.
- 3. The picker MUST preserve close, model_select conversation selection, and reopen ordering before requesting defaults.
- 4. Defaults MUST not show the manual mid-conversation confirmation; manual rows retain current confirmation behavior.
- 5. Feedback MUST use the narrow result selector and MUST not display requested values as confirmed.
</requirements>

## Subtasks

- [x] 7.1 Invoke the action only from a different explicit tab.
- [x] 7.2 Preserve modal ownership and manual selection behavior.
- [x] 7.3 Subscribe narrowly to selected session result.
- [x] 7.4 Render applied, partial, and unavailable feedback.
- [x] 7.5 Extend deterministic fake action and rendered tests.

## Implementation Details

Implement TechSpec System Architecture and Impact Analysis at the UI boundary. The view calls only ControllerActions and does not sequence raw option changes.

### Relevant Files

- src/ui/ModelSelect.tsx — tab flow, modal lifecycle, and memoized selector use.
- src/ui/ModelSelect.test.tsx — rendered picker and tab regressions.
- test/fakeController.ts — deterministic action calls and result events.

### Dependent Files

- src/app/actions.ts — applyProviderDefaults action.
- src/store/selectors.ts — narrow result selector.
- src/core/types.ts — terminal result contract.
- src/ui/StatusStrip.tsx — separate consumer.

### Related ADRs

- [ADR-004: Sequence defaults from agent-confirmed model state](adrs/adr-004.md) — truthful feedback and no speculative values.

## Deliverables

- Explicit-tab-only action invocation.
- Picker labels for applied, partial, and unavailable outcomes.
- Fake controller action support and rendered coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for rendered /model behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Claude-to-Codex tab selects with model_select source, reopens picker, and calls action once for Codex.
  - [x] Opening picker, Escape, cancellation, and manual row changes never call the action.
  - [x] Established-session defaults do not show MODEL_SELECT_CONFIRM_HINT; manual confirmation is unchanged.
- Integration tests:
  - [x] Applied result renders Default applied with confirmed model/effort rows.
  - [x] Partial result renders effort-unavailable copy and post-model confirmed effort.
  - [x] Unavailable model/session labels preserve verified marks and do not bleed between tabs.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Default application occurs only after explicit provider selection.
- Picker feedback never claims an unconfirmed configuration.
