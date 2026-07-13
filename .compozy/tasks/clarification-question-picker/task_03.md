---
status: completed
title: "Complete clarification attention presentation and regression coverage"
type: frontend
complexity: medium
---

# Task 3: Complete clarification attention presentation and regression coverage

## Overview
Finish the user-visible presentation of awaiting clarification through the shared attention model. Clarification must rank first, have distinct accessible language, and reuse existing overview and notifier behavior without a parallel attention system.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST rank awaiting clarification ahead of approval, error, and finished for next-needy routing.
2. MUST render a distinct non-color-only clarification label and glyph.
3. MUST provide a unique clarification tone in every palette.
4. MUST reuse needsAttention and existing notifier eligibility instead of adding clarification-specific notification logic.
</requirements>

## Subtasks
- [x] 3.1 Set clarification attention priority.
- [x] 3.2 Add accessible status-strip vocabulary.
- [x] 3.3 Verify palette and sessions-overview presentation.
- [x] 3.4 Prove notifier behavior remains generic and deduplicated.

## Implementation Details
Follow the TechSpec sections System Architecture, Implementation Design, Testing Approach, and Development Sequencing. Keep ACP at the adapter boundary, preserve the reducer as the only SessionState writer, and use existing fail-soft actions and immutable store patterns.

### Relevant Files
- src/store/selectors.ts — clarification attention rank.
- src/store/selectors.test.ts — list and next-needy coverage.
- src/ui/StatusStrip.tsx — label and glyph.
- src/ui/StatusStrip.test.tsx — visible status coverage.
- src/ui/theme.ts — palette status tones.
- src/ui/SessionsOverlay.test.tsx — shared needs-you presentation.
- src/notify/notifier.test.ts — transition and dedup regression coverage.

### Dependent Files
- src/core/types.ts — supplies awaiting_clarification.
- src/ui/SessionsOverlay.tsx — generic SessionCard consumes the shared status.

### Related ADRs
- [ADR-001: Scope the clarification picker around explicit structured requests](adrs/adr-001.md)
- [ADR-002: Present supported clarification requests as immediate session-attributed dialogs](adrs/adr-002.md)

## Deliverables
- Completed complete clarification attention presentation and regression coverage behavior.
- Updated or new focused tests covering the stated requirements.
- Unit tests with 80%+ coverage (REQUIRED).
- Integration tests for the relevant clarification lifecycle (REQUIRED).

## Tests
- Unit tests:
  - [x] Next-needy selects clarification ahead of simultaneous approval, error, and finished sessions.
  - [x] Status strip renders question-mark clarification text with the matching palette tone.
  - [x] Sessions overview renders clarification plus one needs-you badge.
  - [x] Unfocused working-to-clarification alerts once; focused transitions and needy-to-needy transitions do not alert.
- Integration tests:
  - [x] Exercise this task through its declared boundary with its declared dependencies present.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Requirements are satisfied without ACP types escaping src/agent.
- Existing permission, prompt, and modal behavior remains unchanged outside active clarification.
