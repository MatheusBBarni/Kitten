---
status: completed
title: Fail-Closed Capability and Adapter Guard
type: refactor
complexity: high
---

# Task 03: Fail-Closed Capability and Adapter Guard

## Overview

Make the adapter boundary uphold the one-active-prompt invariant even when a caller bypasses controller actions. Establish a protocol-free, exact-certification capability seam that remains unavailable in V1 unless both resolved recipe identity and adapter behavior are deliberately certified.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. The steering capability MUST be protocol-free outside `src/agent/`, default to unavailable, and never be inferred from provider name, display metadata, or a bare `AgentConfig`.
- 2. Capability resolution MUST accept native steering only when an exact certified resolved recipe and an adapter-local terminal-acknowledgement implementation are both present.
- 3. A second `AgentConnection.prompt()` while another prompt is in flight MUST reject before ACP dispatch and MUST NOT clear, replace, or otherwise disturb the original in-flight record.
- 4. The original prompt MUST continue to receive its normal terminal result and status after a rejected concurrent call.
- 5. This task MUST NOT invent a generic ACP steering method, add provider user flags, leak provider extension data above the adapter, or implement controller fallback behavior.
</requirements>

## Subtasks

- [x] 3.1 Define the closed, protocol-free steering capability vocabulary and exact certification classifier.
- [x] 3.2 Resolve the capability only after the final provider recipe is fully merged and validated.
- [x] 3.3 Enforce a reject-before-replacement guard around adapter prompt entry.
- [x] 3.4 Preserve current single-prompt completion and error behavior for the original call.
- [x] 3.5 Add exact-recipe and in-memory transport regressions for default, override, and concurrent-prompt cases.

## Implementation Details

Use the TechSpec “Integration Points,” “Technical Dependencies,” and Build Order adapter step. Follow the clarification-capability classifier’s exact command, ordered-argument, and full-environment matching pattern, while keeping steering capability separate from clarification semantics.

### Relevant Files

- `src/core/types.ts` — adds the protocol-free capability carried by resolved configuration.
- `src/config/steeringCapability.ts` — new exact certification classifier that fails closed by default.
- `src/config/steeringCapability.test.ts` — new table-driven exact-recipe and unavailable-default coverage.
- `src/config/configLoader.ts` — resolves steering capability after final recipe merging.
- `src/config/configLoader.test.ts` — verifies default and command/args/env override resolution.
- `src/agent/agentConnection.ts` — rejects concurrent prompt entry without replacing its active record.
- `src/agent/agentConnection.test.ts` — uses the in-memory ACP mock to prove original prompt preservation.

### Dependent Files

- `src/app/steeringCoordinator.ts` — may select a native path only from the verified resolved capability.
- `src/app/controller.ts` — receives resolved runtime configuration and must not infer adapter support itself.
- `src/core/steering.ts` — keeps lifecycle behavior provider-neutral regardless of capability class.

### Related ADRs

- [ADR-001: Adopt a Lossless, Provider-Neutral Steering Contract for V1](adrs/adr-001.md) — requires a consistent outcome across providers.
- [ADR-003: Model Steering as a Protocol-Free State Machine with a Controller Effect Runner](adrs/adr-003.md) — assigns ACP protection to the adapter boundary.
- [ADR-004: Fail Closed on Native Steering and Recover Unsent Text on Lifecycle Loss](adrs/adr-004.md) — requires exact certification and V1 unavailability.

## Deliverables

- A fail-closed protocol-free capability contract and exact config-resolution classifier.
- Adapter-level concurrent-prompt protection that preserves the original prompt record.
- Unit tests with 80%+ coverage of capability classification and concurrent-prompt guard behavior.
- Integration tests through an in-memory ACP transport proving one active adapter prompt.

## Tests

- Unit tests:
  - [x] Every default, unknown, floating-version, custom, and overridden provider recipe resolves steering capability to unavailable.
  - [x] Only a complete exact command, ordered-argument, environment, and certified-adapter match can classify as native-capable.
  - [x] A bare `AgentConfig` cannot grant native capability.
  - [x] A second prompt entered while a deferred first prompt is active rejects before dispatch and leaves the original in-flight record intact.
  - [x] Releasing the original deferred prompt yields its ordinary result and terminal status after the rejection.
- Integration tests:
  - [x] An in-memory ACP mock receives exactly one prompt when two concurrent calls are attempted, and the first call settles normally.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- No direct adapter caller can create or displace a second active prompt.
- Native steering remains unavailable until a complete audited certification exists.
