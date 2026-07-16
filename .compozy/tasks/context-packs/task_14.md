---
status: pending
title: Content-free Context Pack telemetry
type: backend
complexity: high
---

# Task 14: Content-free Context Pack telemetry

## Overview

Add opt-in local telemetry for only closed Context Pack lifecycle outcomes and coarse buckets. Its schema must structurally prevent content, identity, recipe, destination, and raw-error retention.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- The recorder MUST support exactly these fixed event names: context_pack_draft_created, build_started, build_denied, build_settled, review_ready, review_blocked, sealed, seal_denied, fit_available, fit_unavailable, fit_insufficient, delivery_confirmed, and delivery_denied.
- Event fields MUST use closed reason enums and coarse selection/redaction/byte/duration buckets only.
- Instructions, paths, source identities/digests, rationale, materialized bytes, payload, recipe/model, recipient, export destination, provider identity, child identity, and raw errors MUST be unrepresentable/rejected.
- Disabled telemetry MUST remain a true no-op: no sink creation, writes, or lifecycle bookkeeping.
- Controller events MUST occur only after the corresponding Context Pack result settles and private lifecycle callbacks MUST deduplicate.
</requirements>

## Subtasks

- [ ] 14.1 Add the fixed Context Pack event union, reason enums, and coarse bucket contracts.
- [ ] 14.2 Extend active and no-op recorders with structural allowlist validation and deduplication.
- [ ] 14.3 Emit settled controller lifecycle outcomes for draft/build/review/seal/fit/delivery.
- [ ] 14.4 Preserve disabled-recorder behavior and reject content-bearing inputs.
- [ ] 14.5 Add recorder, controller, and local JSONL integration coverage.

## Implementation Details

Follow the TechSpec telemetry allowlist and privacy constraints. This task does not add a self-check, CLI flag, real-adapter probe, certification script, CI activation, or documentation command.

### Relevant Files

- src/telemetry/recorder.ts — fixed Context Pack events and allowlisted serializer.
- src/telemetry/recorder.test.ts — schema, no-op, dedupe, and sentinel coverage.
- src/app/controller.ts — settled lifecycle outcome emission.
- src/app/controller.test.ts — controller event ordering coverage.
- test/telemetry.integration.test.ts — local JSONL end-to-end privacy coverage.

### Dependent Files

- src/core/contextPack.ts — typed review, seal, and fit results.
- src/app/contextPackBridge.ts — build lifecycle outcomes.
- src/app/handoff.ts — later attachment/delivery route.
- src/app/actions.ts — controller action dispatch facade.

### Related ADRs

- [ADR-001: Plan the full Context Packs contract with evidence-gated vertical delivery](adrs/adr-001.md)
- [ADR-002: Launch Context Packs as a verified-provider pilot for trusted focused handoffs](adrs/adr-002.md)
- [ADR-003: Keep Context Packs session-keyed and persist only manifests plus sealed bytes](adrs/adr-003.md)
- [ADR-005: Fail closed on Recipient Fit for every Context Pack consumption path](adrs/adr-005.md)

## Deliverables

- Opt-in local JSONL lifecycle events with only fixed names, enums, and coarse buckets.
- Structural privacy enforcement, disabled-recorder no-op behavior, and callback deduplication.
- Controller emission only after actual transition outcomes.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for complete and denied flows with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Every lifecycle method emits only its exact type and allowlisted key set.
  - [ ] Forged enum values, extra fields, exact counters, and duplicate private callbacks record nothing additional.
  - [ ] A disabled recorder can receive every Context Pack event while a throwing sink is never accessed.
  - [ ] Serialization sentinels for all prohibited content/identity/error fields never appear in records.
- Integration tests:
  - [ ] A permitted flow writes ordered draft-created, build, review, seal, fit, and delivery outcomes to local JSONL.
  - [ ] A stale/denied flow writes only its fixed outcome/reason categories, and all JSON keys are limited to the documented allowlist.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Telemetry measures feature outcomes without retaining Context Pack content or operational identities.
- Opt-out behavior and privacy enforcement are independently testable.
