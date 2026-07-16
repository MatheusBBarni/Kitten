---
status: completed
title: Record content-free agent_run telemetry
type: backend
complexity: medium
---

# Task 07: Record content-free agent_run telemetry

## Overview

Add opt-in local telemetry for whether bounded agent-run control is used and how it resolves, without collecting work content or route identifiers. The telemetry surface is intentionally closed and records control-operation duration only, not child execution duration.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. Agent-run telemetry MUST use a closed vocabulary containing only operation, fixed outcome, bounded batch-size bucket, and duration bucket.
- 2. Records MUST NOT include task text, desired outcome, child or parent IDs, generation, provider, capability, route, endpoint, path, prompt, transcript, raw error, or lifecycle status.
- 3. Controller emission MUST occur only after a route-authorized start or poll operation settles and MUST measure operation duration only.
- 4. Disabled telemetry MUST remain a true no-op that does not construct, access, or write a sink.
</requirements>

## Subtasks

- [x] 7.1 Extend the recorder’s closed agent-run event vocabulary and no-op implementation.
- [x] 7.2 Emit bounded operation outcomes from the controller-owned control path.
- [x] 7.3 Bucket batch size and control duration without retaining raw content or identity.
- [x] 7.4 Add allowlist, no-op, and sentinel-leakage regression coverage.

## Implementation Details

Follow the TechSpec “Monitoring and Observability” section, applying the stricter approved task boundary of operation, outcome, batch bucket, and duration bucket only. Reuse existing opt-in recorder and injected controller clock seams; do not alter boot wiring or add remote collection.

### Relevant Files
- `src/telemetry/recorder.ts` — event union, active/no-op recorder behavior, and serialized allowlist.
- `src/telemetry/recorder.test.ts` — exact-field, bucket, no-op, and sensitive-sentinel coverage.
- `src/app/controller.ts` — bounded post-settlement operation measurement and recorder invocation.
- `src/app/controller.test.ts` — injected recorder/clock assertions for accepted and rejected controls.

### Dependent Files
- `src/index.ts` — existing recorder wiring that remains unchanged.
- `test/telemetry.integration.test.ts` — existing local opt-in telemetry integration conventions.
- `src/core/orchestration.ts` — lifecycle source that must not be serialized into agent-run telemetry.

### Related ADRs
- [ADR-002: Validate supervised parallel progress before autonomous orchestration](adrs/adr-002.md) — defines privacy-preserving product learning.
- [ADR-003: Extend the authenticated Kitten MCP bridge with atomic bounded agent control](adrs/adr-003.md) — limits telemetry to content-free fixed buckets.

## Deliverables

- Closed content-free agent-run recorder API and active/no-op implementations.
- Controller operation-level emission with bounded outcome, batch, and duration data.
- Exact allowlist and sensitive-content regression tests.
- Unit and telemetry integration tests with 80%+ coverage.

## Tests

- Unit tests:
  - [x] Accepted start and poll records contain only the approved operation, outcome, batch-size bucket, and duration bucket fields.
  - [x] Rejected and unavailable operations use only fixed allowed outcome values and omit raw error details.
  - [x] Task, outcome, child ID, parent ID, capability, endpoint, path, provider, prompt, transcript, and status sentinels never serialize.
  - [x] A disabled recorder creates no sink access and emits no record.
  - [x] Boundary batch sizes and control durations map to the documented bounded buckets.
- Integration tests:
  - [x] An opt-in local telemetry run records accepted and rejected agent-run control operations without content or identity leakage.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Telemetry reveals only bounded control-use outcomes, never customer content, identifiers, or routes.
- Disabled telemetry remains entirely inert.
