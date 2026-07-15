---
status: pending
title: Add memoized managed-worktree review presentation
type: refactor
complexity: low
---

# Task 02: Add memoized managed-worktree review presentation

## Overview

Project one selector-owned, memoized worktree-review presentation from immutable session binding state. Tabs and session rows must share the same render-safe facts without reading Git state, raw bindings, or ephemeral delegation ownership.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST define one render-safe review model with managed marker, provenance, availability, and bounded labels.
2. MUST map every availability value to explicit non-color-only text and return `null` only for sessions with no binding.
3. MUST reuse one cached presentation object in both session-list and workspace-conversation projections.
4. MUST preserve existing delegation output and selector identity across unrelated transcript or shell updates.
</requirements>

## Subtasks
- [ ] Define the selector-owned review presentation and label maps.
- [ ] Memoize presentation by all rendered binding fields.
- [ ] Add the projection to session-list rows and workspace conversation views.
- [ ] Preserve existing cache and structural-sharing behavior for ordinary sessions.
- [ ] Add focused availability and identity tests.

## Implementation Details

Extend the existing selector/cache patterns described in the TechSpec System Architecture section. Do not render UI or add lifecycle mutations in this task.

### Relevant Files
- `src/store/selectors.ts` — owns delegation presentation, list rows, tab views, and memoization caches.
- `src/store/selectors.test.ts` — verifies selector identity and render-ready values.

### Dependent Files
- `src/ui/TabWorkspace.tsx` — later consumes compact review cues.
- `src/ui/SessionsOverlay.tsx` — later renders detailed review state.
- `src/ui/StatusStrip.tsx` — remains unchanged unless a compact selector cue proves necessary.

### Related ADRs
- [ADR-002: Make in-Kitten review the primary child-workspace completion loop](adrs/adr-002.md) — requires a shared review presentation.
- [ADR-003: Persist managed bindings in versioned session records and reconcile on restore](adrs/adr-003.md) — requires review state independent of delegation.

## Deliverables
- Memoized `ManagedWorktreeReviewPresentation` projection used by both row/view consumers.
- Selector unit tests with >=80% coverage **(REQUIRED)**.
- Integration coverage for restored unavailable and cleanup-refused state **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Every availability value produces a bounded explicit label.
  - [ ] An ordinary session yields `null` review state.
  - [ ] Unchanged selection returns the same presentation reference.
- Integration tests:
  - [ ] A restored unavailable child keeps its own cwd and no reconstructed delegation parent.
  - [ ] Updating one binding replaces only that child row/view while siblings stay referentially stable.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Session lists and tabs receive the same cached review presentation object.
- No selector reads Git state, runtime state, task text, or raw command output.
