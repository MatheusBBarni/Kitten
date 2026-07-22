---
status: completed
title: Build inspector, persistent composer, queue, and attention presentation
type: frontend
complexity: high
---

# Task 16: Build inspector, persistent composer, queue, and attention presentation

## Overview

Build the selected-card supervision surface: chronological durable history,
always-visible composer, explicit queued-follow-up state, and focused Attention
Blocker presentation. It makes every lifecycle state inspectable without
renderer-side ACP, persistence, or cancellation behavior.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. The inspector MUST render chronological work history with newest transcript expanded, immutable Run Context, activity, questions/outcomes, operator messages, terminal, and interruption evidence.
2. The composer MUST remain mounted and visible for every selected-card lifecycle state and preserve a safe unsent draft across refresh/focus changes.
3. Idle text MUST use startAttempt with its initial prompt; active ordinary text MUST use queueFollowUp and MUST never cancel, steer, fork, or duplicate.
4. FIFO drafts MUST be visible/removable and require explicit confirmation after normal settlement.
5. One active Attention Blocker MUST receive focus and visible text priority while history and composer remain visible; ordinary submission MUST wait for a projected terminal blocker outcome.
6. Renderer events, conflicts, and unavailable states MUST use typed projections with semantic landmarks, keyboard control, live announcements, and no host-resource access.
</requirements>

## Subtasks

- [x] 16.1 Build selected-card query/event wiring and chronological attempt timeline.
- [x] 16.2 Build always-mounted composer with distinct idle and active typed commands.
- [x] 16.3 Render queue states, removal, and explicit post-terminal confirmation.
- [x] 16.4 Build focused structured Attention Blocker presentation and outcome controls.
- [x] 16.5 Handle projection/activity/conflict refresh with draft, scroll, and focus safety.
- [x] 16.6 Add fake-RPC renderer and accessibility coverage.

## Implementation Details

Follow the TechSpec Persistent Card Inspector and Composer mapping. Existing
PromptEditor and ConversationView demonstrate local UI principles only; their
active steering behavior is not a desktop implementation source.

### Relevant Files

- packages/desktop/src/renderer/features/inspector/CardInspector.tsx — selected-card shell.
- packages/desktop/src/renderer/features/inspector/CardInspector.test.tsx — inspector coverage.
- packages/desktop/src/renderer/features/inspector/AttemptTimeline.tsx — durable chronology.
- packages/desktop/src/renderer/features/inspector/AttemptTimeline.test.tsx — transcript coverage.
- packages/desktop/src/renderer/features/inspector/PersistentComposer.tsx — always-visible input.
- packages/desktop/src/renderer/features/inspector/PersistentComposer.test.tsx — command/queue coverage.
- packages/desktop/src/renderer/features/inspector/AttentionBlockerPanel.tsx — answer-first panel.

### Dependent Files

- packages/desktop/src/shared/rpc.ts — typed query and command contract.
- packages/desktop/src/attempts/inspectorProjection.ts — durable inspector data.
- packages/desktop/src/attention/attentionCoordinator.ts — blocker outcomes.

### Related ADRs

- [ADR-001: Constrain V1 to a linear governed workflow with queued active-run input](adrs/adr-001.md) — persistent composer contract.
- [ADR-002: Make Attention Blockers the V1 supervision priority](adrs/adr-002.md) — answer-first inspector presentation.
- [ADR-005: Own queued follow-ups and Attention Blockers in the desktop attempt coordinator](adrs/adr-005.md) — queue and blocker state.

## Deliverables

- Persistent selected-card inspector, chronology, queue, composer, and blocker UX.
- Keyboard-accessible focus, queue, answer, and conflict presentation.
- Fake-RPC renderer regression suite.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for projected active, queued, and blocker workflows **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Render newest transcript expanded with Run Context, activity, question/outcome, operator, and terminal/interrupted evidence.
  - [x] Keep composer rendered for idle, running, needs_attention, failed, cancelled, interrupted, ready_for_review, and completed states.
  - [x] Assert idle submit calls startAttempt while active submit calls only queueFollowUp.
  - [x] Verify queue removal and head confirmation; confirm calls once and never auto-sends.
  - [x] Verify a blocker focuses a labeled form, announces status, and blocks ordinary submit while retaining history/composer.
- Integration tests:
  - [x] Refresh one selected card from fake activity/projection events without stale-card contamination.
  - [x] Route each terminal blocker outcome through answerAttention with stable identity.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- A selected card always retains both history and composer.
- No renderer action can turn ordinary follow-up text into cancellation or unconfirmed dispatch.
