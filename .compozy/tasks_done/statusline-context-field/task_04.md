---
status: completed
title: Supply captured-session CONTEXT to preview and prove saved-layout parity
type: frontend
complexity: medium
---

# Task 04: Supply captured-session CONTEXT to preview and prove saved-layout parity

## Overview

Connect the statusline dialog preview to the session captured when the dialog opened, rather than to global focus. Prove that preview and the saved custom footer render equivalent `CONTEXT` output for the same session, layout, and width, while confirmation persists only layout identifiers.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. `StatuslineDialog` MUST select `selectSessionHeadroom(overlay.sessionId)` and pass it as `contextHeadroom` to the preview `StatuslineContext`; it MUST NOT read global focus for preview ownership.
2. A valid captured value MUST preview as `ctx 38%`, while absent or selector-invalid usage MUST omit context cleanly without dangling or duplicate separators.
3. If global focus changes while the dialog remains open, the preview MUST retain the captured target's context and the saved footer MAY correctly reflect the new focused session.
4. Confirmation MUST persist only the literal `"CONTEXT"` layout identifier through the existing action and config projection; no percentage or raw usage data may enter persisted preference or config text.
5. For matching session, layout, and width, preview and saved custom-footer output MUST be equivalent, including deterministic trailing-field removal at narrow widths. This task MUST NOT change config schemas, state, ACP, telemetry, the legacy null-layout footer, or `AgentStatusChip`.
</requirements>

## Subtasks

1. Supply the validated per-session headroom selector to the captured overlay preview context.
2. Preserve captured-session ownership through global-focus changes while the dialog remains open.
3. Add modal regression coverage for valid, unavailable, invalid, and narrow-width preview cases.
4. Prove confirmation persists the literal `CONTEXT` identifier and no dynamic usage data.
5. Add cockpit integration coverage for preview/saved-footer parity and diverging focus ownership.

## Implementation Details

### Relevant Files

- `src/ui/StatuslineOverlay.tsx` — captured-session preview context ownership.
- `src/ui/StatuslineOverlay.test.tsx` — dialog preview, confirmation, and narrow-width coverage.
- `src/ui/CockpitApp.test.tsx` — preview-to-saved-footer parity and focus-change integration coverage.

### Dependent Files

- `src/core/statusline.ts` — canonical renderer and `CONTEXT` contract.
- `src/store/selectors.ts` — per-session headroom selector.
- `src/ui/StatusStrip.tsx` — saved-footer consumer for parity comparison.
- `src/app/actions.ts` — existing identifier-only confirmation path; no changes expected.

### Related ADRs

- [ADR-001: Statusline Context Headroom Field](/Users/matheusbbarni/projects/kitten/.compozy/tasks/statusline-context-field/adrs/adr-001.md)
- [ADR-002: Context Proposal and Persistence Contract](/Users/matheusbbarni/projects/kitten/.compozy/tasks/statusline-context-field/adrs/adr-002.md)
- [ADR-003: Shared Selector Validity and Context Ownership](/Users/matheusbbarni/projects/kitten/.compozy/tasks/statusline-context-field/adrs/adr-003.md)

## Deliverables

- A captured-session preview context that renders `CONTEXT` through the canonical core contract.
- Literal-only `CONTEXT` confirmation coverage and no dynamic usage persistence.
- Colocated modal and cockpit tests for ownership, omission, narrow-width behavior, and preview/saved-footer parity at or above 80% coverage.

## Tests

### Unit Tests

- Open a dialog for `claude-code` with `124_000 / 200_000` usage and assert the preview renders `ctx 38%`.
- Assert a captured target with absent or invalid usage omits context cleanly.
- With sessions at distinct values, switch focus after opening the dialog and assert the preview keeps the captured target's value.
- Render a narrow `[FOLDER, CONTEXT]` preview and assert canonical budgeting removes trailing context without malformed separators.
- Confirm a `[CONTEXT]` layout and assert its projected config contains literal `"CONTEXT"` but neither `38%` nor raw counters.

### Integration Tests

- For the same session, layout, and width, confirm the rendered saved custom footer matches the preview's context output.
- After a focus change, assert an open preview remains target-owned while the saved footer follows the new focused session.

## Success Criteria

- Preview ownership is captured-session based and saved-footer ownership is focused-session based.
- Confirmation never persists runtime headroom data, only literal layout identifiers.
- Preview and saved-footer behavior agree for equal inputs, and all changed tests pass with at least 80% coverage for the implemented behavior.
