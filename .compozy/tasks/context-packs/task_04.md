---
status: pending
title: Closed explore-v2 capability and Recipient Profile evidence
type: backend
complexity: high
---

# Task 04: Closed explore-v2 capability and Recipient Profile evidence

## Overview

Add a separate closed capability and evidence boundary for Context Build and recipient capacity. Production remains unavailable unless a complete, current, reviewed exact recipe is present.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- explore-v2 MUST be a closed versioned capability separate from existing explore-v1 behavior and configuration.
- Production registries MUST be empty unless explicit independently reviewed evidence authorizes an exact provider command, ordered arguments, complete environment, adapter/runtime, and model recipe.
- Context Build eligibility MUST allow only scoped ask_user, bounded draft/workspace reading, and revision-fenced draft mutation.
- Recipient Profiles MUST prove exact capacity, reserve, counter version, and freshness; absent, stale, or incomplete evidence MUST be unavailable.
- No environment override, inferred provider support, or generic estimate MAY activate a build or recipient route.
</requirements>

## Subtasks

- [ ] 4.1 Define closed explore-v2 evidence and exact recipe resolution contracts.
- [ ] 4.2 Define closed Recipient Profile and freshness/capacity evidence contracts.
- [ ] 4.3 Keep production registries fail-closed and separate from explore-v1.
- [ ] 4.4 Add typed deny results for unsupported, stale, and malformed evidence.
- [ ] 4.5 Cover complete evidence, partial evidence, and bypass attempts.

## Implementation Details

Follow the TechSpec capability and Recipient Profile boundaries. This task establishes evidence only; it does not start children, register an MCP bridge, or surface a user override.

### Relevant Files

- src/config/contextPackCapability.ts — new explore-v2 and Recipient Profile resolver.
- src/config/contextPackCapability.test.ts — closed-registry and evidence coverage.
- src/config/exploreCapability.ts — existing v1 boundary kept unchanged.
- src/config/exploreCapability.test.ts — regression coverage for v1 isolation.
- src/config/harnessCapability.ts — existing capability composition seam.
- src/config/harnessCapability.test.ts — composition regression coverage.
- src/core/types.ts — protocol-free evidence and closed reason vocabulary.

### Dependent Files

- src/app/controller.ts — later build and consumption preflight caller.
- src/app/contextPackBridge.ts — later route authorization caller.
- src/core/contextPack.ts — later Recipient Fit evaluation.

### Related ADRs

- [ADR-001: Plan the full Context Packs contract with evidence-gated vertical delivery](adrs/adr-001.md)
- [ADR-002: Launch Context Packs as a verified-provider pilot for trusted focused handoffs](adrs/adr-002.md)
- [ADR-004: Use a separate generation-bound Context Pack bridge for explore-v2](adrs/adr-004.md)
- [ADR-005: Fail closed on Recipient Fit for every Context Pack consumption path](adrs/adr-005.md)

## Deliverables

- Closed explore-v2 and Recipient Profile evidence resolvers.
- Empty-by-default production capability/profile registries.
- Typed availability and denial outcomes with no implicit fallback.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for configuration composition with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] A fully matching reviewed recipe resolves only when command, argument order, environment, adapter, runtime, and model all match.
  - [ ] Partial, stale, unknown, or reordered evidence is unavailable with a closed reason.
  - [ ] Recipient capacity without a fresh exact counter/reserve evidence is unavailable.
  - [ ] Environment variables and generic estimates cannot create an eligible recipe or profile.
  - [ ] Existing explore-v1 resolution remains report-only and unchanged.
- Integration tests:
  - [ ] Capability composition exposes no Context Build authority while the production registry is empty.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Context Build and recipient eligibility are evidence-backed and fail closed.
- Existing Explore behavior is not broadened or retrofitted.
