---
status: pending
title: "Define Generation-Scoped Harness Delivery State"
type: refactor
complexity: medium
---

# Task 01: Define Generation-Scoped Harness Delivery State

## Overview

Create the pure, protocol-free state machine that defines harness delivery for one live controller generation. It establishes the invariant that stale or terminal lifecycle work cannot re-open a delivery opportunity, giving later controller, persistence, and UI tasks one tested source of truth.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add a pure protocol-free delivery model for `not_required`, `pending`, `in_flight`, `delivered`, and fixed terminal `failed` states; see TechSpec "Core Interfaces" and "Data Models".
2. MUST require the expected controller generation for every state transition and make stale-generation transitions harmless no-ops.
3. MUST distinguish a known pre-dispatch failure, which may leave delivery pending, from every post-invocation ambiguity, which MUST terminalize the generation without automatic replay.
4. MUST expose only fixed failure categories and harness version metadata; MUST NOT import ACP types or retain harness text, user blocks, paths, or raw errors.
5. MUST consume the protocol-free rendered harness contract from #18 as an external prerequisite without re-owning its wording or rendering.
</requirements>

## Subtasks

- [ ] 1.1 Define the generation-scoped delivery state and fixed failure categories.
- [ ] 1.2 Define valid fresh, loaded, dispatch, terminal, and replacement transitions.
- [ ] 1.3 Prevent stale or repeated transitions from changing the current state.
- [ ] 1.4 Preserve the distinction between retry-safe pre-dispatch failure and indeterminate post-dispatch failure.
- [ ] 1.5 Add colocated tests for every valid and invalid transition.

## Implementation Details

Add the helper described in TechSpec "Core Interfaces" and "Implementation Design" within the existing `src/app/` package. Keep it independent of controller I/O so task_03 can consume it at all fresh/load/replacement paths and task_04 can serialize its content-free checkpoint.

### Relevant Files

- `src/app/harnessDelivery.ts` — new pure delivery state helper.
- `src/app/harnessDelivery.test.ts` — new colocated Bun coverage for transitions.
- `src/app/controller.ts` — source of `AgentRuntime.generation`, ACP identity, and future integration facts.
- `src/core/harnessPrompt.ts` — #18 prerequisite expected to provide protocol-free rendered harness data.

### Dependent Files

- `src/app/controller.ts` — task_03 consumes the helper for lifecycle routing.
- `src/config/harnessCapability.ts` — task_02 maps unsupported profiles into fixed delivery failures.
- `src/persistence/runRecord.ts` — task_04 persists the content-free checkpoint.
- `src/app/controller.test.ts` — task_03 exercises the helper through real lifecycle seams.

### Related ADRs

- [ADR-001: Scope harness delivery by live ACP session generation](adrs/adr-001.md) — defines generation ownership and no unsafe replay.
- [ADR-003: Own delivery state by controller generation and persist only a content-free checkpoint](adrs/adr-003.md) — constrains state shape and failure semantics.
- [ADR-004: Gate harness encoding through exact certified runtime profiles](adrs/adr-004.md) — requires unsupported profiles to fail closed.

## Deliverables

- Pure generation-scoped delivery state helper with fixed transition outcomes.
- Colocated unit and composite lifecycle tests.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration-style state-flow tests for replacement isolation **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Fresh creation produces `pending`; loaded creation produces `not_required` and cannot dispatch a harness.
  - [ ] Matching `pending` dispatch becomes `in_flight`; stale, terminal, and loaded states do not change.
  - [ ] Matching completion becomes `delivered`; duplicate or stale completion preserves current state.
  - [ ] Pre-dispatch failure remains retryable while post-dispatch ambiguity becomes fixed `failed`.
  - [ ] Replacement starts independent `pending` state and rejects late completion or failure from the old generation.
- Integration tests:
  - [ ] Fold a fresh-to-dispatch-to-terminal sequence through the exported helper and confirm no later transition can create a second dispatch opportunity.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every transition is protocol-free and generation-guarded.
- No state shape can retain prompt or harness content.
