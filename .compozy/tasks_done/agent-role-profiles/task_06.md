---
status: completed
title: Add content-free explore telemetry and cross-layer safety hardening
type: backend
complexity: high
---

# Task 06: Add content-free explore telemetry and cross-layer safety hardening

## Overview

Record opt-in explore policy outcomes without recording delegated content or identity, then prove the cross-layer privacy and lifecycle contract at serialization and restore boundaries. This task completes the production-safety evidence without adding remote analytics, a new telemetry sink, or a testing-only implementation track.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add only fixed allowlisted explore telemetry events for eligible launch, typed denial, capacity denial, startup failure, and current-child terminal state.
- MUST allow only closed enums and counters beyond common recorder fields; task/outcome, prompt/transcript, session/child/ACP ids, title, CWD/path, recipe/config, model/effort, attestation payload, MCP details, raw errors, and active-child identities/counts are forbidden.
- MUST keep policy telemetry local and opt-in; disabled recorders MUST remain true no-ops that do not touch a sink.
- MUST emit accepted eligibility only after registration succeeds, capacity denial only for atomic admission refusal, and terminal telemetry at most once for a current generation.
- MUST preserve ephemeral delegation and policy state across persistence/restore; no snapshot, restrictions, limits, attestation, or ownership may serialize as live authority.
</requirements>

## Subtasks
- [x] 6.1 Add fixed explore policy event types and recorder methods.
- [x] 6.2 Emit allowlisted outcomes from accepted launch and current lifecycle transitions.
- [x] 6.3 Preserve no-op behavior and private recorder dedupe keys.
- [x] 6.4 Add JSONL sentinel tests for forbidden content and identity values.
- [x] 6.5 Add restore/persistence regressions for ephemeral policy-bearing delegation state.
- [x] 6.6 Run the packet’s full feature verification gate after all cross-layer changes.

## Implementation Details

Follow TechSpec sections “Monitoring and Observability,” “Testing Approach,” and “Known Risks.” Extend the existing local recorder and controller telemetry facade only; no remote transport, user-facing analytics, alerting system, persistence schema, or free-form event payload is in scope.

### Relevant Files
- `src/telemetry/recorder.ts` — event union, recorder facade, no-op behavior, and JSONL records.
- `src/telemetry/recorder.test.ts` — event-shape, opt-out, and private-sentinel unit tests.
- `src/app/controller.ts` — accepted launch, typed denial, startup, and generation-fenced terminal event hooks.
- `src/app/controller.test.ts` — injected recorder/connection tests for lifecycle event ordering and dedupe.
- `test/telemetry.integration.test.ts` — serialized JSONL privacy boundary tests.
- `test/sessionRestore.integration.test.ts` — delegation/policy state remains ephemeral after restore.
- `src/persistence/runWriter.test.ts` — run serialization regression coverage if explore state reaches persistence descriptors.

### Dependent Files
- `src/core/explorePolicy.ts` — closed reason/category vocabulary used by recorder events.
- `src/core/orchestration.ts` — current terminal lifecycle identity and capacity outcomes.
- `src/store/appStore.ts` — ephemeral delegation reset behavior.
- `src/index.ts` — existing opt-in recorder construction remains unchanged.

### Related ADRs
- [ADR-001: Fail Closed with an Attestable Fixed Explore Profile](adrs/adr-001.md) — requires local content-free decisions.
- [ADR-005: Reserve Explore Capacity Atomically at Child Registration](adrs/adr-005.md) — defines distinct capacity-denial outcomes.
- [ADR-006: Verify the Explore Contract Through Layered Tests](adrs/adr-006.md) — defines recorder, controller, integration, and restore proof layers.

## Deliverables

- Allowlisted opt-in explore telemetry events and no-op-safe recorder methods.
- Controller lifecycle emission with fixed categories and current-generation deduplication.
- JSONL privacy, opt-out, capacity, startup, terminal, and restore regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for JSONL serialization and ephemeral restore behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Disabled recorder invokes every explore method without constructing or touching a throwing sink.
  - [x] Enabled recorder accepts only the exact allowlisted keys, enums, and counters for every explore event.
  - [x] Compile-time/runtime payload checks reject unknown enum values and extra fields.
  - [x] Eligibility emits only after registration, capacity denial emits only its closed scope, and duplicate/stale terminal callbacks add no event.
- Integration tests:
  - [x] JSONL output with task, outcome, ids, CWD, title, recipe, model, attestation, MCP, and raw-error sentinels contains none of those values or fields.
  - [x] Missing/stale proof, capacity refusal, accepted startup failure, and current terminal lifecycle serialize only their corresponding fixed categories.
  - [x] Persisted run and restored session state omit explore snapshot, restrictions, limits, attestation, and delegation ownership; old callbacks cannot recreate them.
  - [x] Targeted telemetry/controller/persistence suites pass before the repository typecheck, full tests, self-check, and build gate.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Explore telemetry is opt-in, local, fixed-schema, and contains no delegated content or identity.
- Restored sessions contain no live explore authority or policy snapshot.
