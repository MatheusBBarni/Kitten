---
status: pending
title: Build the conversation-first timeline and direct composer presentation
type: frontend
complexity: high
---

# Task 12: Build the conversation-first timeline and direct composer presentation

## Overview

Reshape the existing inspector into a conversation-first reading and prompting
experience. Messages remain primary, technical activity moves into progressive
disclosure, attempt selection survives refresh, and composer feedback matches
the host's durable direct-submission states.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. User and agent messages MUST form the primary chronological path while tool, lifecycle, plan, and Run Context detail remains accessible through secondary disclosures.
2. Attempt selection MUST be controlled by workbench state and survive revision refresh when the identity remains valid.
3. Evidence summaries MUST attach to the producing attempt without loading patch chunks.
4. Composer mode MUST distinguish initial, active-direction, and request-changes submission and MUST use host lifecycle truth for availability.
5. Enter MUST submit one trimmed non-empty message; Shift+Enter, IME composition, repeated keydown, busy state, and duplicate callbacks MUST NOT cause extra commands.
6. Drafts MUST clear only after durable acceptance and MUST remain intact for interrupted, conflict, stale-evidence, or unavailable results.
7. Streamed refresh MUST preserve reading position unless the user is near the end or has just submitted.
</requirements>

## Subtasks

- [ ] 12.1 Make messages primary and group technical activity into accessible disclosures.
- [ ] 12.2 Bind attempt selection and deterministic fallback to workbench view state.
- [ ] 12.3 Attach changed-file evidence summaries to their producing attempt.
- [ ] 12.4 Present explicit initial, queued, dispatching, dispatched, interrupted, blocked, and request-changes states.
- [ ] 12.5 Enforce keyboard, IME, single-flight, draft-clear, and retry behavior.
- [ ] 12.6 Preserve conversation scroll position during streamed refresh.
- [ ] 12.7 Add hierarchy, selection, composer, scrolling, and accessibility coverage.

## Implementation Details

Follow the TechSpec **Conversation-first timeline** and **Direct submission**
contracts. Reshape the existing timeline and composer; do not introduce a
second transcript or submission state machine. Keep component styling
utility-first.

### Relevant Files

- `packages/desktop/src/renderer/features/inspector/AttemptTimeline.tsx` — conversation-first chronology and activity disclosures.
- `packages/desktop/src/renderer/features/inspector/AttemptTimeline.test.tsx` — hierarchy, order, selection, and evidence attachment.
- `packages/desktop/src/renderer/features/inspector/PersistentComposer.tsx` — direct-submit interaction and delivery state.
- `packages/desktop/src/renderer/features/inspector/PersistentComposer.test.tsx` — keyboard, IME, retry, and state coverage.
- `packages/desktop/src/renderer/features/inspector/useInspectorCommands.ts` — precise host outcomes for presentation.
- `packages/desktop/src/renderer/features/inspector/CardInspector.tsx` — controlled selection, drafts, evidence links, and scroll behavior.

### Dependent Files

- `packages/desktop/src/renderer/features/inspector/CardInspector.test.tsx` — integrated refresh, selection, draft, and review-link behavior.

### Related ADRs

- [ADR-001: Adopt a T3 Code-Inspired Supervision Loop While Preserving Kitten's Workflow Model](adrs/adr-001.md) — conversation-first workbench with immutable attempts.
- [ADR-002: Make Blocked Work and Evidence-Bound Review First-Class](adrs/adr-002.md) — mutation-free Request changes draft.
- [ADR-004: Persist Immutable Review Evidence and Page Diffs by File](adrs/adr-004.md) — evidence summary without patch duplication.
- [ADR-005: Treat Enter as Prompt Authorization and Dispatch FIFO at Safe Boundaries](adrs/adr-005.md) — composer authorization and queue presentation.

## Deliverables

- Conversation-first attempt presentation with progressive technical detail.
- Direct composer states, draft safety, retry, and scroll-preservation behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for revision refresh, direct submission, and review linking **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Preserve deterministic message/activity/blocker order at equal timestamps.
  - [ ] Render messages as primary and grouped technical activity as accessible disclosures.
  - [ ] Preserve an older selected attempt across refresh and fall back when it disappears.
  - [ ] Open review from the correct attempt/evidence summary without requesting a chunk.
  - [ ] Submit once on Enter and never on Shift+Enter, IME composition, repeat, busy, or duplicate keydown.
  - [ ] Clear only after durable acceptance and retain exact drafts for every retryable failure.
  - [ ] Preserve upward scroll position while following updates only near the end.
- Integration tests:
  - [ ] Show queued feedback immediately after active-turn durable acceptance.
  - [ ] Restore an interrupted draft and dispatch only after explicit retry.
  - [ ] Seed/focus Request changes without any host mutation.
  - [ ] Keep attention-blocked drafts intact with clear next-action guidance.
  - [ ] Preserve keyboard focus, status announcements, and reduced-motion behavior.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The latest attempt reads as a conversation while durable evidence remains available.
- Direct composer feedback matches host truth without confirmation language.
