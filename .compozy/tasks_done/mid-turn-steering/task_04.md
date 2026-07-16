---
status: completed
title: Privacy-Safe Steering Observability
type: refactor
complexity: medium
---

# Task 04: Privacy-Safe Steering Observability

## Overview

Add opt-in, local, content-free visibility into steering outcomes while proving that queued and recovered developer text remains live-only. This makes delivery failures measurable without adding a steering history, persistence schema, or replay path.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. Telemetry MUST remain opt-in and local; a disabled recorder MUST not construct or touch its sink.
- 2. Steering telemetry MUST emit only allowlisted outcomes (`queued`, `delivered`, `recovered`, `timeout`, `unavailable`), capability class, and a coarse duration bucket.
- 3. Telemetry MUST NOT emit prompt blocks, recovery text, request or ACP ids, paths, raw provider errors, adapter configuration, or unbucketed timing values.
- 4. The run-writer snapshot MUST remain schema-neutral and MUST NOT serialize steering queue data, recovery data, request identifiers, or raw failures.
- 5. Private lifecycle keys MAY support in-memory dedupe and timing only; no automatic retry, persistence, or replay behavior may be introduced.
</requirements>

## Subtasks

- [x] 4.1 Add a closed content-free steering outcome record and recorder facade surface.
- [x] 4.2 Keep any lifecycle identity and timing state private while reducing durations to named coarse buckets.
- [x] 4.3 Preserve no-op recorder behavior when telemetry is disabled.
- [x] 4.4 Retain the run writer’s whitelist projection without a schema version bump or steering field.
- [x] 4.5 Add explicit allowlist, dedupe, disabled-recorder, and serialized-sentinel exclusions.

## Implementation Details

Follow the TechSpec “Monitoring and Observability” section and ADR-004’s non-persistent recovery decision. Preserve the recorder’s established local JSONL and allowlist patterns; the run writer should remain a whitelist projection unless a necessary defensive exclusion is identified.

### Relevant Files

- `src/telemetry/recorder.ts` — owns opt-in recorder behavior, closed telemetry records, private timing, and dedupe.
- `src/telemetry/recorder.test.ts` — proves exact record keys, disabled no-op behavior, duration bucketing, and sentinel exclusion.
- `src/persistence/runWriter.ts` — owns the schema-neutral whitelist snapshot that must exclude steering live state.
- `src/persistence/runWriter.test.ts` — proves queued/recovery/id/error sentinels never serialize.

### Dependent Files

- `src/app/steeringCoordinator.ts` — reports only approved lifecycle outcomes through the recorder facade.
- `src/core/steering.ts` — owns the live raw queue and recovery payload that must never leave memory.
- `src/persistence/runStore.ts` — consumes the writer’s persisted record without a schema revision.

### Related ADRs

- [ADR-001: Adopt a Lossless, Provider-Neutral Steering Contract for V1](adrs/adr-001.md) — constrains measurement to product outcomes.
- [ADR-003: Model Steering as a Protocol-Free State Machine with a Controller Effect Runner](adrs/adr-003.md) — requires raw queued blocks to remain live-only.
- [ADR-004: Fail Closed on Native Steering and Recover Unsent Text on Lifecycle Loss](adrs/adr-004.md) — forbids persistence and automatic replay.

## Deliverables

- Opt-in content-free telemetry records for allowlisted steering outcomes.
- Private dedupe/timing behavior with coarse duration buckets only.
- Preserved whitelist persistence boundary with no steering schema addition.
- Unit tests with 80%+ coverage of recorder allowlists and serialization exclusions.
- Integration tests for local recorder output and persisted run snapshots.

## Tests

- Unit tests:
  - [x] A disabled recorder invokes steering APIs without constructing, reading, or writing a sink.
  - [x] Each allowlisted outcome emits only the approved keys, capability class, and coarse duration bucket.
  - [x] Duplicate lifecycle callbacks with the same private key produce one record without exposing that key.
  - [x] JSON telemetry never contains prompt, recovery, request-id, ACP-id, path, raw-error, or adapter-config sentinels.
  - [x] A run-writer snapshot seeded with steering queue/recovery/error sentinels omits every sentinel and all steering fields.
- Integration tests:
  - [x] An enabled local recorder writes a content-free steering outcome record while the associated persisted run snapshot remains free of steering content.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Steering outcome telemetry is useful without carrying developer content or identifiers.
- Persisted run records remain schema-compatible and contain no steering queue or recovery data.
