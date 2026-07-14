---
status: pending
title: Add fixed timeout configuration and content-free telemetry outcomes
type: backend
complexity: medium
---

# Task 02: Add fixed timeout configuration and content-free telemetry outcomes

## Overview

Add the Kitten-owned fixed clarification timeout with a five-minute default, and extend local telemetry to observe the richer terminal outcomes without ever recording form content or routing identities. This makes timeout behavior predictable for operators and measurable for the PRD’s expansion gate.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. Configuration MUST expose one positive bounded clarification timeout with a default of 300 seconds and no per-MCP-call override.
- 2. Existing strict configuration parsing and optional-file behavior MUST remain unchanged for configurations that omit the new setting.
- 3. Telemetry MUST record only expanded fixed terminal categories and coarse duration buckets.
- 4. Telemetry records MUST NOT contain question text, answer text, field IDs, option labels, endpoint paths, capabilities, or request identifiers.
</requirements>

## Subtasks

- [ ] 2.1 Add the fixed timeout configuration surface and default.
- [ ] 2.2 Validate accepted and rejected timeout values under the existing strict schema rules.
- [ ] 2.3 Expand closed clarification telemetry categories for submitted, skipped, timed_out, and cancelled results.
- [ ] 2.4 Prove emitted records remain content-free after the outcome expansion.

## Implementation Details

Use the TechSpec “Data Models,” “Monitoring and Observability,” and “Impact Analysis” sections. Keep timeout ownership in Kitten configuration and retain the existing opt-in local JSONL contract.

### Relevant Files
- `src/config/configLoader.ts` — owns strict application configuration schema, merge, and defaults.
- `src/config/configLoader.test.ts` — establishes parsing, defaulting, and strict-validation patterns.
- `src/telemetry/recorder.ts` — owns closed clarification outcome and duration record shapes.
- `src/telemetry/recorder.test.ts` — validates recorder output and redaction invariants.

### Dependent Files
- `src/core/types.ts` — provides the shared terminal-outcome vocabulary.
- `test/telemetry.integration.test.ts` — validates end-to-end content-free telemetry records.
- `src/app/controller.ts` — consumes the configured timeout when it creates a clarification request.

### Related ADRs
- [ADR-002: Reserve MVP questions for consequential operator decisions](adrs/adr-002.md) — establishes transparent timeout as a product outcome.
- [ADR-004: Define a bounded multi-field contract with a Kitten-owned five-minute timeout](adrs/adr-004.md) — fixes timeout ownership and default.

## Deliverables

- A strict fixed-timeout configuration with a 300-second default.
- Expanded content-free telemetry outcome categories and duration measurement.
- Config and telemetry tests with 80%+ coverage of changed behavior.
- Integration evidence that records omit all interaction content and route identity.

## Tests

- Unit tests:
  - [ ] Omitted clarification settings resolve to the five-minute default.
  - [ ] Zero, negative, non-numeric, and out-of-range timeout values fail strict validation.
  - [ ] Each terminal outcome records only its closed enum and a coarse duration bucket.
  - [ ] Recorder output omits prompt, answer, option, field, capability, endpoint, and request-ID data.
- Integration tests:
  - [ ] A timed-out clarification emits one content-free terminal record in an opt-in telemetry run.
  - [ ] A disabled telemetry run creates no clarification output.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- All sessions use a predictable five-minute default unless the validated Kitten configuration changes it.
- Telemetry supports outcome-rate measurement without exposing interaction content.
