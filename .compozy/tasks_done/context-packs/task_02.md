---
status: completed
title: Store-owned Context Pack slice and selectors
type: refactor
complexity: high
---

# Task 02: Store-owned Context Pack slice and selectors

## Overview

Make the AppStore the sole mutable owner of each session's current draft, sealed pack, review candidate, and live build binding. Expose narrow stable selectors for UI and controller use.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- The store MUST hold Context Pack state in a SessionId-keyed projection for every seeded and dynamically created session.
- Draft creation, refinement, operator mutation, builder mutation, review publication, sealing, and build bind/release MUST be atomic owner transitions.
- Session removal, delegation-child removal, and session replacement MUST remove only their matching Context Pack projection.
- Review candidates and build bindings MUST be live-only and never reintroduced through store initialization.
- Selectors MUST return stable null fallbacks and preserve identity for unrelated session updates.
</requirements>

## Subtasks

- [x] 2.1 Add the session-keyed Context Pack state projection and initialization behavior.
- [x] 2.2 Add atomic draft, review, sealed, and build-binding transitions.
- [x] 2.3 Clear Context Pack state at every existing session-removal boundary.
- [x] 2.4 Add narrow Context Pack, draft, sealed, review, and build selectors.
- [x] 2.5 Prove session isolation, structural sharing, and cleanup in tests.

## Implementation Details

Follow the TechSpec State Model and Store Actions. Keep filesystem reads, bridge registration, telemetry, and recipient resolution outside AppStore; the store only applies already-authorized typed transitions.

### Relevant Files

- src/store/appStore.ts — session-keyed mutable ownership and atomic transitions.
- src/store/appStore.test.ts — transition, cleanup, and isolation coverage.
- src/store/selectors.ts — narrow stable Context Pack projections.
- src/store/selectors.test.ts — selector identity and fallback coverage.
- src/core/contextPack.ts — pure transition and validation values.
- src/core/types.ts — SessionId and Context Pack contracts.

### Dependent Files

- src/persistence/runStore.ts — later persistence restoration commits.
- src/app/controller.ts — later lifecycle owner and transition caller.
- src/ui/ContextPackPanel.tsx — later selector-only presentation.

### Related ADRs

- [ADR-003: Keep Context Packs session-keyed and persist only manifests plus sealed bytes](adrs/adr-003.md)
- [ADR-004: Use a separate generation-bound Context Pack bridge for explore-v2](adrs/adr-004.md)
- [ADR-005: Fail closed on Recipient Fit for every Context Pack consumption path](adrs/adr-005.md)

## Deliverables

- Session-addressed AppStore Context Pack state and atomic actions.
- Cleanup at all existing session lifecycle removals.
- Stable narrow selector family.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for session isolation with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Two sessions retain distinct drafts, sealed values, reviews, and build bindings.
  - [x] Each mutation invalidates the correct review while preserving unrelated session references.
  - [x] Removal of a session or delegation child clears only its Context Pack state.
  - [x] Replacing sessions cannot leave an orphan projection or live build binding.
  - [x] Missing sessions return stable null projections and unrelated updates preserve selector identity.
- Integration tests:
  - [x] A controller-style sequence can create, review, bind, release, and seal one addressed session without altering a sibling session.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- AppStore is the only mutable Context Pack owner.
- UI and controller callers can select an addressed session without broad subscriptions or cross-session leakage.
