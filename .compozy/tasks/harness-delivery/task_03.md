---
status: pending
title: "Route First Prompts Through Controller-Owned Delivery"
type: refactor
complexity: high
---

# Task 03: Route First Prompts Through Controller-Owned Delivery

## Overview

Route all first visible tasks through the controller-owned delivery state and certified adapter envelope. The shared seam must cover normal fresh start, replacement, fallback, configured opening task, fresh context, and confirmed handoff while leaving loaded sessions and follow-up prompts untouched.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST make `src/app/controller.ts` the sole owner of fresh/load/fallback/replacement delivery decisions; see TechSpec "System Architecture".
2. MUST run delivery/profile validation before `actions.sendPrompt` records a visible `user_message`, so unsupported delivery records and sends no user turn.
3. MUST send exactly one harness-bearing envelope for a matching-generation fresh first task and only original blocks for follow-ups and successful loaded sessions.
4. MUST generation-guard completion and failure after every await, including replacement, cancellation, close, and disposal paths.
5. MUST route configured initial tasks, `startFreshFromContext`, and confirmed handoff-first tasks through the shared seam without changing preview-before-confirm behavior.
6. MUST publish only the minimal content-free checkpoint projection required by task_04; durable V3 serialization and rendered UI remain deferred to later tasks.
</requirements>

## Subtasks

- [ ] 3.1 Inject the controller-owned delivery-aware dispatch seam into actions.
- [ ] 3.2 Classify new, loaded, fallback, replacement, and close lifecycle paths.
- [ ] 3.3 Gate first visible dispatch on task_01 state and task_02 certification.
- [ ] 3.4 Preserve original-block transcript and prompt-history behavior.
- [ ] 3.5 Apply generation guards to terminal and teardown outcomes.
- [ ] 3.6 Cover first-task variants and no-duplicate follow-up behavior.

## Implementation Details

Use TechSpec "System Architecture", "PRD Requirement Mapping", and "Testing Approach". `actions.sendPrompt` stays the UI call surface and continues to own visible-block recording; the controller supplies a delivery-aware dispatch dependency so the adapter boundary receives an envelope only after lifecycle/profile validation. Publish only a fixed checkpoint projection sufficient for task_04's writer; do not serialize it or render a recovery notice here.

### Relevant Files

- `src/app/controller.ts` — owns runtime generation, session creation/load/fallback/replacement, and injected action dependencies.
- `src/app/actions.ts` — shared visible prompt seam and recovery action surface.
- `src/app/controller.test.ts` — in-process ACP harness for lifecycle and visible-content assertions.
- `src/app/harnessDelivery.ts` — task_01 transition and generation guard helper.
- `src/config/harnessCapability.ts` — task_02 exact-profile eligibility decision.
- `src/agent/agentConnection.ts` — task_02 envelope-consuming ACP boundary.
- `src/store/appStore.ts` — receives the minimal content-free checkpoint projection for task_04 persistence.

### Dependent Files

- `src/app/handoff.ts` — remains unchanged because confirmed handoff already calls the shared prompt action.
- `src/app/handoff.test.ts` — preserves explicit target and confirm-only regression behavior.
- `src/persistence/runRecord.ts` — task_04 owns durable checkpoint handling.
- `src/ui/ConversationView.tsx` — task_05 owns rendered recovery state.

### Related ADRs

- [ADR-001: Scope harness delivery by live ACP session generation](adrs/adr-001.md) — controller authority and original-block separation.
- [ADR-003: Own delivery state by controller generation and persist only a content-free checkpoint](adrs/adr-003.md) — identity and stale-work handling.
- [ADR-004: Gate harness encoding through exact certified runtime profiles](adrs/adr-004.md) — fail closed before visible prompt recording.

## Deliverables

- Controller-owned first-dispatch path covering every fresh lifecycle entry point.
- Original-only transcript and prompt-history behavior for all visible turns.
- Generation-safe terminal settlement with no automatic resend after possible dispatch.
- Content-free checkpoint projection for task_04 without durable serialization or UI rendering.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for fresh, loaded, replacement, initial-task, and handoff flows **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Fresh `session/new` sends one harness envelope, records only original blocks, and settles delivery once.
  - [ ] Follow-up after delivery sends original blocks without a harness.
  - [ ] Successful `session/load` records and forwards its first user task without a harness.
  - [ ] Failed-load fallback, start-new, and replacement each create one new first-delivery opportunity while old-generation completion is ignored.
  - [ ] Configured opening task and fresh-context task use the same delivery-aware seam.
- Integration tests:
  - [ ] Confirmed handoff to a fresh target sends one harness-bearing request only after preview confirmation and never adds harness text to curated blocks.
  - [ ] Close, cancellation, partial update, or thrown prompt after invocation terminalizes the generation without re-submitting the first visible task.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every fresh first task uses one controller-authorized envelope.
- Loaded and follow-up tasks remain harness-free and all visible artifacts retain only user content.
