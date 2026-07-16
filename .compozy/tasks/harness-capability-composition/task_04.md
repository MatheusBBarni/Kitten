---
status: pending
title: Content-free composition telemetry
type: backend
complexity: medium
---

# Task 04: Content-free composition telemetry

## Overview

Add a bounded opt-in telemetry outcome for the final fresh-generation composition decision and prove that composition metadata never enters persisted run records. The record must give maintainers useful static selection evidence without retaining hidden prompt text or runtime/session secrets, and must remain silent when telemetry is disabled.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. MUST add one closed opt-in composition outcome through the existing local telemetry recorder only after a final fresh-generation composition is accepted.
- 2. MUST restrict the record to reviewed static selection metadata: contract version, static selection identity or closed outcome, selected count, and base-only state; it MUST contain no prompt text, task or repository content, paths, credentials, endpoint/token, ACP identity, provider recipe, environment values, profile ID, or raw error.
- 3. MUST keep telemetry disabled as a no-op that constructs no composition record and writes no sink output.
- 4. MUST not add composition metadata to application state, run-record versions, run-writer snapshots, or restore behavior; successful loaded sessions MUST emit no composition event.
- 5. MUST preserve non-fatal recorder behavior and existing delivery state semantics when recording is unavailable or disabled.
</requirements>

## Subtasks

- [ ] 4.1 Define the closed composition telemetry event and recorder API within the existing content-free allowlist.
- [ ] 4.2 Emit one final outcome from the controller's eligible fresh-generation dispatch path.
- [ ] 4.3 Preserve no-op behavior for disabled telemetry, loaded sessions, and non-final or failed composition candidates.
- [ ] 4.4 Add exact-key and serialized-sentinel assertions for the telemetry record.
- [ ] 4.5 Add persistence-negative coverage proving V3 run snapshots omit composition data.

## Implementation Details

See TechSpec sections “Monitoring and Observability”, “Persistence and Runtime Data”, “Failure Handling”, and “Testing Strategy”. Reuse the recorder's closed-record construction and sink bottleneck; do not create storage or telemetry transport beyond its existing local opt-in seam.

### Relevant Files

- `src/telemetry/recorder.ts` — owns the closed event union, field allowlist, opt-in no-op recorder, and local JSONL sink boundary.
- `src/telemetry/recorder.test.ts` — verifies disabled behavior, exact allowlisted keys, and absence of private sentinel data.
- `src/app/controller.ts` — emits the final composition result only from the accepted pending fresh-generation path.
- `src/app/controller.test.ts` — verifies fresh-only emission, follow-up silence, loaded-session silence, and safe behavior around non-final outcomes.
- `src/persistence/runWriter.test.ts` — proves serialized V3 snapshots omit composition content and metadata without changing writer or record schema.

### Dependent Files

- `src/persistence/runWriter.ts` — remains a lifecycle-only snapshot writer and must not change its persisted field set.
- `src/persistence/runRecord.ts` — remains the existing V3 schema with no composition migration.
- `src/app/harnessDelivery.ts` — continues to define which first-dispatch lifecycle state is eligible for final composition.

### Related ADRs

- [ADR-001: Compose Fresh Harnesses from Confirmed Capability Snapshots](adrs/adr-001.md) — constrains content-free composition metadata.
- [ADR-002: Make Truthful Capability Guidance a Silent Fresh-Run Default](adrs/adr-002.md) — keeps healthy starts silent and diagnostics actionable.
- [ADR-004: Keep Composition Metadata Ephemeral and Telemetry-Only](adrs/adr-004.md) — selects live runtime plus opt-in telemetry and forbids persistence changes.

## Deliverables

- A closed opt-in telemetry event and recorder method for final composition outcomes.
- Controller emission limited to accepted fresh-generation composition decisions.
- Privacy and disabled-recorder regression coverage plus a V3 persistence-negative assertion.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for fresh telemetry and persistence boundaries **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] An enabled recorder emits an exact allowlisted composition record for a confirmed fragment selection and for a valid base-only selection.
  - [ ] A disabled recorder writes no composition record and does not construct or use a sink.
  - [ ] Serialized telemetry omits prompt, repository, path, endpoint, token, ACP identity, profile, environment, provider-recipe, and raw-error sentinels.
  - [ ] A non-final, rejected, or failed composition candidate cannot be reported as a successful composed outcome.
- Integration tests:
  - [ ] The first eligible fresh dispatch emits one final composition outcome; a follow-up dispatch emits none.
  - [ ] A successfully restored session emits no composition telemetry, and the serialized V3 run snapshot omits composition identifiers and text sentinels.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Composition observability remains opt-in, local, bounded, and structurally content-free.
- Persisted run records and restore behavior contain no composition result or hidden guidance data.
