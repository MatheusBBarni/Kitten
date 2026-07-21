---
status: completed
title: Persist only the settled-interrupted harness checkpoint
type: refactor
complexity: high
---

# Task 03: Persist only the settled-interrupted harness checkpoint

## Overview

Extend the generation-scoped harness checkpoint so a confirmed cancellation followed by terminal settlement records the closed `settled_interrupted` fact. Persistence must retain only fixed metadata and must never serialize queued continuation blocks or recovery state.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. A matching confirmed hard stop followed by terminal settlement MUST transition only the active in-flight harness delivery to `settled_interrupted` exactly once; that state is terminal and distinct from both `delivered` and `failed`.
- 2. A timeout, connection error, generation change, or indeterminate dispatch MUST remain fail-closed and MUST NOT claim settled interruption.
- 3. The app-store projection, run-record schema, and writer MUST preserve only version, generation, fixed state, and allowed fixed failure metadata.
- 4. Queued continuation text, blocks, recovery payloads, provider errors, and session identifiers beyond existing record ownership MUST NOT enter persisted checkpoint data.
- 5. Restored `settled_interrupted` metadata MUST remain a closed, no-replay historical fact and MUST NOT recreate a harness opportunity, continuation request, or recovery payload.
</requirements>

## Subtasks

- [ ] 3.1 Add the generation-matched, in-flight-only `settled_interrupted` terminal transition without reopening dispatch.
- [ ] 3.2 Widen the content-free app-store checkpoint projection while keeping its failed-only recovery notice semantics.
- [ ] 3.3 Extend the strict persisted checkpoint union and writer allow-list for the new fixed state.
- [ ] 3.4 Rebind restored `settled_interrupted` metadata as a closed no-replay fact while preserving existing pending, in-flight, and failed recovery behavior.
- [ ] 3.5 Add focused terminality, strict-shape, writer, and read-back sentinel coverage.

## Implementation Details

Treat `settled_interrupted` as a durable harness-delivery fact, not continuation state. The controller remains responsible for deciding when proof exists; this task makes the resulting fixed checkpoint representable, terminal, and content-free. Follow the TechSpec “Harness Delivery and Persistence”, “Persistence, Telemetry, and Privacy”, and “Error Handling and Fail-Closed Rules” sections.

### Relevant Files
- `src/app/harnessDelivery.ts` — owns the generation-matched transition, terminal-state closure, and restore rebind without importing controller or prompt content.
- `src/app/harnessDelivery.test.ts` — covers the in-flight-only transition, duplicate/stale no-ops, terminal closure, and no-replay restoration.
- `src/store/appStore.ts` — widens the fixed checkpoint projection while keeping notices limited to the existing failed recovery fact.
- `src/store/appStore.test.ts` — proves `settled_interrupted` is projected without a draft-bearing notice or unrelated-state replacement.
- `src/persistence/runRecord.ts` — adds the new member to the existing strict discriminated checkpoint union; no content-bearing optional fields are allowed.
- `src/persistence/runWriter.ts` — writes the new terminal state through the existing version/generation/state allow-list branch.
- `src/persistence/runWriter.test.ts` — round-trips the fixed state and proves sentinel continuation-like fields are absent from serialized records.

### Dependent Files
- `src/persistence/runStore.ts` and `src/persistence/runStore.test.ts` — existing schema-backed decode/read-back seam to extend with the new accepted state and strict extra-field rejection.
- `src/app/controller.ts` and `src/app/controller.test.ts` — later orchestration records the transition only after proof and must not rebuild live continuation state on restore.
- `src/core/postInterruptContinuation.ts` — intentionally remains live-only and absent from snapshots.

### Related ADRs
- [ADR-001: Scope the feature to explicit hard stops in V1](adrs/adr-001.md) — bounds the checkpoint trigger.
- [ADR-004: Require attested settlement and metadata-only persistence](adrs/adr-004.md) — defines durability and privacy rules.

## Deliverables

- `settled_interrupted` harness-delivery transition and projection.
- Strict persisted-record and writer support for fixed metadata only.
- Colocated delivery, store, and persistence tests, including read-back through the strict run-store schema boundary.

## Tests

- Unit tests:
  - [ ] Only a matching in-flight generation can become `settled_interrupted`; duplicate settlement, stale generations, and every other terminal state are identity-preserving no-ops.
  - [ ] Pending, timeout, connection-error, generation-replaced, and indeterminate delivery paths cannot produce `settled_interrupted`.
  - [ ] The strict schema accepts exactly version, generation, and `settled_interrupted`, and rejects failure metadata, blocks, request IDs, recovery text, raw errors, and unknown fields.
- Integration tests:
  - [ ] Writer and run-store read-back preserve `settled_interrupted` as a closed checkpoint without constructing a continuation request or delivery opportunity.
  - [ ] Sentinel draft, block, request-ID, recovery, and raw-error strings are absent from serialized run records.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- A settled interruption survives read-back only as content-free, closed checkpoint metadata.
- No pending continuation, request identity, or recovery payload can persist through the run writer or schema-backed reader.
