---
status: completed
title: "Emission-validation debug log for usage"
type: backend
complexity: low
dependencies:
  - task_02
---

# Task 03: Emission-validation debug log for usage

## Overview
Add a gated, content-free debug log emitted when a usage event is observed, recording provider plus `used`/`size`, so the team can confirm which adapters actually emit `usage_update` before the gauge is relied upon.
This is the instrument-first validation from ADR-002, front-loaded to de-risk the feature's core assumption that the agents report usage at all.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST emit a structured, content-free record `{ evt: "usage_seen", provider, used, size }` when a usage event is observed, carrying no transcript content.
- MUST gate the log behind the existing telemetry opt-in / an env flag, defaulting to off, reusing the recorder's opt-in discipline.
- MUST identify the emitting provider (`claude-code` / `codex`) from existing session/runtime identity.
- MUST expose the gating as a pure, unit-testable function that produces the record when enabled and suppresses it when disabled.
- MUST NOT alter the domain event, reducer, selector, or UI.
</requirements>

## Subtasks
- [x] 3.1 Add a content-free usage-seen logging function gated by the existing opt-in flag.
- [x] 3.2 Invoke it where a usage event is observed with provider identity available.
- [x] 3.3 Ensure it produces no output when the flag is off.
- [x] 3.4 Add tests for the gated, content-free behavior.

## Implementation Details
Hook where the usage event is observed with session/provider identity available — the controller's store subscription (`src/app/controller.ts`, the `connection.onUpdate((event) => store.applyEvent(seed.id, event))` line) or the connection layer — and reuse the opt-in `enabled` gate and content-free rules from `src/telemetry/recorder.ts`.
Log numbers and the provider only; never transcript text. See TechSpec "Monitoring and Observability".

### Relevant Files
- `src/telemetry/recorder.ts` — the opt-in `enabled` gate and content-free discipline to reuse.
- `src/app/controller.ts` — the store subscription where session/provider identity is available.
- `src/agent/agentConnection.ts` — alternative hook point; provides `providerKind` identity.

### Dependent Files
- A co-located test for the gated logger (e.g., `src/telemetry/*.test.ts` or beside the hook).

### Related ADRs
- [ADR-002: Validation-gated honest MVP](../adrs/adr-002.md) — instrument-first emission validation.

## Deliverables
- A gated, content-free usage-seen logger and its wiring at the usage-observation point.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test that the logger is invoked on usage dispatch when enabled **(REQUIRED)**

## Tests
- Unit tests:
  - [x] When enabled, a usage observation produces one record `{ evt: "usage_seen", provider: "claude-code", used: 124000, size: 200000 }` with no transcript-text field.
  - [x] When disabled (default), a usage observation produces no record.
  - [x] The record contains only `provider` plus numeric `used`/`size` (no content keys).
- Integration tests:
  - [x] With logging enabled, dispatching a usage event through the store subscription invokes the logger once with the correct provider.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- No output when disabled; content-free when enabled
- Domain, reducer, selector, and UI are untouched
