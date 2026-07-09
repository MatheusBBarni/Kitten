---
status: pending
title: "Effort-tagged hand-off"
type: frontend
complexity: medium
dependencies:
  - task_03
  - task_05
  - task_06
---

# Task 08: Effort-tagged hand-off

## Overview
Let a developer set the target agent's model and effort inside the hand-off preview, so escalating ("hand this over at high effort") is one confirm-and-send.
This adds a target model/effort control to the preview, carries the choice through the hand-off edits, and applies it to the target before the handed-off prompt.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a model/effort control to the hand-off preview sourced from the TARGET agent's `visibleConfigOptions`, reusing the control from task_06.
- MUST extend `HandoffEdits` with `targetConfig: { configId: string; value: string }[]` carrying the chosen target model/effort.
- MUST apply the chosen target config via the `setSessionConfigOption` action (task_05) as part of `confirm`, before the handed-off prompt is sent.
- MUST default the control to the target's current values and allow sending with no change (empty `targetConfig`).
- MUST NOT show the mid-conversation degrade warning for the hand-off (the target receives a fresh prompt), and MUST preserve the existing file/diff drop and summary-edit behavior.
</requirements>

## Subtasks
- [ ] 8.1 Seed the target's `visibleConfigOptions` into the hand-off preview on `begin`
- [ ] 8.2 Render the target model/effort control in `HandoffPreview` reusing the task_06 control
- [ ] 8.3 Extend `HandoffEdits` with `targetConfig` and thread it through `send`
- [ ] 8.4 Apply `targetConfig` on the target via the controller action during `confirm`
- [ ] 8.5 Cover the seeded default, an escalation, and a no-change send with tests

## Implementation Details
Modify the hand-off flow and preview. See TechSpec "System Architecture" (Hand-off) and ADR-001 (effort composes with hand-off). `createHandoffFlow.begin` opens the preview (`handoff.ts:164-184`); `confirm` composes blocks and sends (`handoff.ts:186-208`); the preview `send` reads edits (`HandoffPreview.tsx:121-127`) with the summary editor at 208-220.

### Relevant Files
- `src/app/handoff.ts` — `HandoffEdits` (64-71), `begin` (164-184), `confirm` (186-208)
- `src/ui/HandoffPreview.tsx` — `send` (121-127), editor region (208-220)
- `src/store/appStore.ts` — `HandoffPreviewOverlay` (42-46) to carry the target options snapshot
- `src/app/handoff.test.ts`, `src/ui/HandoffPreview.test.tsx` — flow and rendered tests

### Dependent Files
- `src/telemetry/recorder.ts` (task_09) — records effort-linked hand-offs from this flow

### Related ADRs
- [ADR-001: V1 scope](adrs/adr-001.md) — effort-tagged hand-off is the differentiator
- [ADR-002: V1 rollout as a compose-complete MVP](adrs/adr-002.md) — ships with the MVP
- [ADR-004: Live in-place switching with confirmed-state UI and a category allowlist](adrs/adr-004.md) — the applied target switch is confirmed-state

## Deliverables
- Target model/effort control in the hand-off preview
- `HandoffEdits.targetConfig` applied to the target on confirm
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test of an escalating hand-off end to end **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `begin` seeds the preview with the target agent's visible model/effort options and current values
  - [ ] `confirm` with a `targetConfig` of `{model: opus, effort: high}` calls `setSessionConfigOption` on the target for each before sending the prompt
  - [ ] `confirm` with empty `targetConfig` sends the hand-off without any config call
  - [ ] The hand-off path shows no mid-conversation degrade warning
- Integration tests:
  - [ ] From the preview: raising the target effort then sending applies the target's effort and forwards the bundle to the target, then switches focus
  - [ ] File/diff drop and summary edit still work with the new control present
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A developer can hand off at a chosen target model/effort in one confirm-and-send
- Existing hand-off editing behavior is unchanged
