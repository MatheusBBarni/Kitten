---
status: completed
title: Attest safe continuation settlement at the adapter boundary
type: refactor
complexity: high
---

# Task 02: Attest safe continuation settlement at the adapter boundary

## Overview

Introduce the fail-closed capability verdict that says a configured provider can prove the cancellation and terminal-settlement boundary required before a same-session continuation. Provider evidence remains in the adapter layer; application code receives only a protocol-free verdict.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. Capability support MUST require exact, provider-attested evidence that cancellation was accepted and the original turn reached terminal settlement.
- 2. Missing, stale, mismatched, or unreviewed provider evidence MUST resolve to an unavailable verdict.
- 3. The application-facing capability MUST be protocol-free and MUST NOT expose ACP payloads, raw errors, prompts, or provider-session identifiers.
- 4. Configuration loading and provider setup MUST preserve current agents while leaving all unverified recipes fail-closed.
- 5. Tests MUST prove both certified admission and every unsupported-evidence rejection path.
</requirements>

## Subtasks

- [ ] 2.1 Define the protocol-free safe-settlement capability and its closed unavailable reasons.
- [ ] 2.2 Add the exact reviewed profile/evidence resolver following the existing steering and clarification capability conventions.
- [ ] 2.3 Keep provider-specific attestation declarations in `src/agent/` and thread only the normalized closed verdict through resolved configuration.
- [ ] 2.4 Ensure profile or release drift resolves unavailable without changing ordinary prompt behavior.
- [ ] 2.5 Add focused resolver, configuration, and adapter-boundary tests.

## Implementation Details

Use the existing steering and clarification certification patterns as structural references: the adapter-local implementation registry remains in `src/agent/`, while `findAgentConfig()` classifies the fully merged recipe into a protocol-free verdict. Follow the TechSpec “Safe Settlement Proof Contract” and “Architecture and Component Changes” sections; do not give core or UI layers ACP knowledge. Production must begin unavailable when no reviewed hard-stop implementation and exact recipe attestation are present.

### Relevant Files
- `src/core/types.ts` — protocol-free continuation capability vocabulary.
- `src/config/hardStopContinuationCapability.ts` — new exact-recipe certification and fail-closed verdict resolver.
- `src/config/hardStopContinuationCapability.test.ts` — new matching, drift, incomplete-evidence, and unavailable-resolver coverage.
- `src/agent/hardStopContinuation.ts` — new adapter-local registry of reviewed hard-stop implementations and their cancellation-plus-terminal-settlement attestation.
- `src/config/configLoader.ts` — extends `findAgentConfig()` so a fully merged recipe receives only the normalized verdict.
- `src/config/configLoader.test.ts` — default-denial and merged-recipe wiring coverage.

### Dependent Files
- `src/app/controller.ts` — later hard-stop orchestration consumes the closed verdict.
- `src/config/steeringCapability.ts` — reference pattern only; its steering authority remains unchanged.
- `src/config/clarificationCapability.ts` — reference pattern only; its credentialed exact-recipe allowlist remains separate.
- `src/agent/nativeSteering.ts` — reference pattern only; steering ownership remains separate from continuation settlement.
- `src/agent/agentConnection.ts` — must remain the ACP anti-corruption boundary; this task must not expose ACP payloads through its public interface.

### Related ADRs
- [ADR-002: Preserve one safe continuation with explicit recovery](adrs/adr-002.md) — requires proof before dispatch.
- [ADR-004: Require attested settlement and metadata-only persistence](adrs/adr-004.md) — defines the fail-closed proof rule.

## Deliverables

- Protocol-free safe-settlement capability and unavailable reasons.
- Exact provider evidence resolver and configuration wiring.
- Focused config and adapter-boundary test coverage.

## Tests

- Unit tests:
  - [ ] Injected complete matching exact-recipe certification plus a matching adapter-local implementation resolves supported, while the production-empty registry remains unavailable.
  - [ ] Missing implementation, incomplete attestation, unknown recipe, adapter version drift, reordered arguments, and environment overrides resolve unavailable.
  - [ ] The exposed verdict contains no provider payload, content, or raw error fields.
- Integration tests:
  - [ ] `findAgentConfig()` preserves an unverified provider's ordinary resolved configuration while classifying only continuation recovery as unavailable.
  - [ ] Configuration merging cannot let a version, command, ordered-argument, or environment drift inherit a prior certification.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Only reviewed exact provider evidence can unlock post-interrupt continuation.
- ACP-specific evidence remains outside `src/core`, `src/store`, and `src/ui`.
