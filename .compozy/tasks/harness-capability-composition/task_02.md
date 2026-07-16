---
status: pending
title: Fresh-generation controller composition
type: backend
complexity: high
---

# Task 02: Fresh-generation controller composition

## Overview

Integrate the pure composition contract into the controller's fresh-generation delivery path without changing the stable base harness, exact profile eligibility, or loaded-session continuity. The controller must derive and revalidate only generation-valid, content-free capability facts immediately before the first eligible dispatch, falling back safely to base-only guidance when confirmation is lost.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. MUST keep `src/app/controller.ts` as the sole owner of runtime capability discovery, generation lifetime, and fresh-session delivery truth.
- 2. MUST consider bridge-child-control confirmed only for the live ready generation with pending fresh delivery and a matching generated bridge declaration; endpoint, token, command, arguments, environment, and ACP values MUST NOT cross into core.
- 3. MUST capture a fresh candidate after successful new-session setup and recompute the closed context immediately before the first pending dispatch; it MUST cache only the final in-memory composition for that generation.
- 4. MUST pass the selected static blocks to the existing renderer while preserving exact certified-profile gating, existing delivery failure behavior, raw user blocks, and no automatic update to an active or restored conversation.
- 5. MUST produce a valid base-only fresh dispatch when optional evidence is absent, stale, invalidated, or conflicting, and MUST keep successful loaded sessions harness-free.
</requirements>

## Subtasks

- [ ] 2.1 Add an injectable controller seam for the pure composer and closed runtime-context derivation.
- [ ] 2.2 Hold only ephemeral composition state for the active fresh generation and clear it at generation replacement or disposal.
- [ ] 2.3 Derive the V1 bridge fact from current controller-owned bridge registration and fresh delivery state.
- [ ] 2.4 Supply revalidated composed blocks to the existing first-dispatch renderer path.
- [ ] 2.5 Prove fresh, replacement, fallback, base-only, stale-evidence, and loaded-session lifecycle outcomes.

## Implementation Details

See TechSpec sections “Data Models”, “Detailed Design”, “Failure Handling”, and “Testing Strategy”. Use the established controller injection and fake-connection patterns; no new state-store field, persistence record, ACP type, or UI surface is needed.

### Relevant Files

- `src/app/controller.ts` — owns generation-bound bridge facts, fresh delivery, controller injection seams, and prompt-envelope preparation.
- `src/app/controller.test.ts` — contains existing fresh first/follow-up, replacement-generation, bridge, and loaded-session test seams to extend.
- `src/core/harnessCapabilityComposition.ts` — supplies the completed pure context and composition contracts.
- `src/core/harnessPrompt.ts` — continues to render the base contract plus explicitly supplied static blocks.

### Dependent Files

- `src/app/harnessDelivery.ts` — preserves the pending/not-required delivery state machine that constrains composition timing.
- `src/app/kittenMcpBridge.ts` — continues to own opaque, session-and-generation-bound bridge registration.
- `src/config/harnessCapability.ts` — retains independent exact-profile eligibility and must not become a source of capability facts.

### Related ADRs

- [ADR-001: Compose Fresh Harnesses from Confirmed Capability Snapshots](adrs/adr-001.md) — requires generation-valid confirmation and base-only fallback.
- [ADR-002: Make Truthful Capability Guidance a Silent Fresh-Run Default](adrs/adr-002.md) — preserves silent healthy starts and continuity boundaries.
- [ADR-003: Compose Capabilities in Core and Make the Adapter Envelope-Only](adrs/adr-003.md) — assigns discovery and lifecycle truth to the controller.

## Deliverables

- A controller-only capability-context derivation and injectable composition seam.
- Ephemeral fresh-generation composition capture and last-moment revalidation before the existing renderer is invoked.
- Updated lifecycle coverage for selected, base-only, replacement, fallback, stale, and loaded-session outcomes.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for first-dispatch lifecycle composition **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] A ready fresh generation with a matching bridge declaration sends exactly the selected V1 fragment in its first harness envelope while preserving user blocks.
  - [ ] A base-only fresh generation sends the valid baseline envelope with no optional fragment text.
  - [ ] A stale, invalidated, absent, or mismatched bridge fact revalidates to base-only without bypassing exact profile eligibility.
  - [ ] Replacement generation two derives a new context and never reuses generation-one composition.
- Integration tests:
  - [ ] A follow-up prompt carries no harness after the first delivery, while a fresh fallback session recomposes for its new generation.
  - [ ] A successfully loaded session remains `not_required` and sends raw prompt blocks even when bridge provisioning exists.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Optional guidance is emitted only from current fresh-generation controller facts and otherwise degrades to a valid base-only start.
- Restored and active conversations retain their existing operating assumptions without a new hidden fragment.

