---
status: pending
title: Context Pack attention cues
type: frontend
complexity: medium
---

# Task 13: Context Pack attention cues

## Overview

Project a completed Context Build as a distinct textual Context Pack attention cue on its owning session. It must not forge agent session status, steal focus, open review, or alter existing attention ordering.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- Context Pack attention MUST be derived from the session-scoped Context Pack projection and MUST remain distinct from ACP SessionStatus.
- The owning tab MUST show a non-color-only textual ready cue without changing selectedVisibleId, focused pane, overlay state, or session status.
- Explicitly selecting/reopening the owning session MAY acknowledge only the Context Pack cue and MUST NOT open review automatically.
- Existing approval/error/finished attention ordering and jumpToNextAttention behavior MUST remain unchanged.
- Selectors MUST preserve stable projections for sessions without Context Pack attention.
</requirements>

## Subtasks

- [ ] 13.1 Define a narrow selector-derived Context Pack attention projection.
- [ ] 13.2 Render the text cue in the owning session tab/workspace surface.
- [ ] 13.3 Acknowledge only that cue on explicit session interaction.
- [ ] 13.4 Preserve existing agent attention and jump behavior.
- [ ] 13.5 Add background-completion and accessibility coverage.

## Implementation Details

Follow the TechSpec no-surprises background-build UX. The lifecycle sets review-ready state earlier; this task only projects and acknowledges attention without changing ACP status ownership.

### Relevant Files

- src/store/selectors.ts — Context Pack attention projection.
- src/store/selectors.test.ts — projection identity and absent-state coverage.
- src/ui/TabWorkspace.tsx — owning-session contextual cue.
- src/ui/TabWorkspace.test.tsx — focus, acknowledgment, and ordering coverage.

### Dependent Files

- src/store/appStore.ts — session-owned review/build state.
- src/app/actions.ts — existing attention navigation boundary.
- src/core/workspace.ts — existing ACP SessionStatus contract.
- src/ui/SessionsOverlay.tsx — existing attention ordering presentation.

### Related ADRs

- [ADR-001: Plan the full Context Packs contract with evidence-gated vertical delivery](adrs/adr-001.md)
- [ADR-002: Launch Context Packs as a verified-provider pilot for trusted focused handoffs](adrs/adr-002.md)
- [ADR-003: Keep Context Packs session-keyed and persist only manifests plus sealed bytes](adrs/adr-003.md)

## Deliverables

- Selector-derived distinct Context Pack attention cue.
- Accessible owning-tab presentation and explicit acknowledgment behavior.
- No SessionStatus mutation, focus transfer, modal opening, or agent-attention regression.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for background completion and attention ordering with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Sessions without Context Pack state receive a stable absent attention projection.
  - [ ] A review-ready Context Pack produces a textual Context ready cue without modifying SessionStatus.
  - [ ] Explicit acknowledgment clears only the Context Pack cue.
- Integration tests:
  - [ ] Build completion for background session B preserves focus, selectedVisibleId, and overlays for session A while rendering B's cue.
  - [ ] Explicitly selecting B acknowledges its cue and does not auto-open review.
  - [ ] Existing approval/error/finished ordering and jumpToNextAttention behavior are unchanged.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Background Context Build completion is visible without surprise navigation or forged agent status.
- Existing attention semantics remain intact.
