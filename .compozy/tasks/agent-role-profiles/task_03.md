---
status: completed
title: Add attested fail-closed explore child launch and MCP isolation
type: backend
complexity: critical
---

# Task 03: Add attested fail-closed explore child launch and MCP isolation

## Overview

Replace inherited delegated-child authority with a closed provider-specific attestation path and a typed `explore` launch result. A child may start only from current, exact restricted-runtime evidence and must receive a fresh attested recipe plus exactly the scoped built-in question bridge.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a closed app-owned verifier patterned after existing exact-recipe capability registries; user configuration MUST NOT declare a role, safety override, attestation, or eligible provider.
- MUST require exact provider, command, ordered arguments, full environment, adapter/runtime version, and restrictive-policy evidence before an `explore` launch is eligible.
- MUST keep the production eligible-provider allowlist empty until reviewed execution-time restricted-child evidence exists; Codex full-access defaults and empty Cursor certification are not eligible.
- MUST return a typed denial before connection creation, bridge registration, ACP `newSession`, store registration, reservation, or prompt dispatch for all missing, stale, unknown, mismatched, partial, or non-restrictive evidence.
- MUST create an eligible child from a fresh attested recipe rather than cloning `parentRuntime.config`.
- MUST expose only the generation-scoped built-in `kitten-ask-user` bridge to an eligible child; global external MCP and agent-control declarations are forbidden.
- MUST deny safely and clean temporary state if scoped bridge provisioning fails, capacity is rejected, startup fails, or a generation becomes stale.
</requirements>

## Subtasks
- [x] 3.1 Define the closed provider evidence registry and exact-match attestation result.
- [x] 3.2 Add typed `explore` launch and availability results to the controller action surface.
- [x] 3.3 Gate fresh child creation on accepted evidence and atomic capacity admission.
- [x] 3.4 Isolate eligible child MCP configuration to the scoped question bridge.
- [x] 3.5 Preserve ordinary-session provider and MCP behavior outside the `explore` path.
- [x] 3.6 Add denial, accepted-fake-evidence, bridge-failure, and stale-generation coverage.

## Implementation Details

Implement TechSpec sections “Core Interfaces,” “Integration Points,” and “Technical Dependencies.” Reuse the exact-recipe, closed-allowlist style of `harnessCapability.ts` and the empty-allowlist fail-closed posture of `clarificationCapability.ts`; do not modify strict user configuration to add a safety declaration.

### Relevant Files
- `src/config/exploreCapability.ts` — new closed provider evidence and attestation verifier.
- `src/config/exploreCapability.test.ts` — new exact-match, mismatch, and non-restrictive-evidence tests.
- `src/config/harnessCapability.ts` — closest exact provider recipe/version evidence pattern.
- `src/config/clarificationCapability.ts` — existing empty-allowlist fail-closed pattern.
- `src/app/controller.ts` — delegated launch, fresh runtime registration, MCP composition, cleanup, and typed outcomes.
- `src/app/actions.ts` — controller action façade for the new launch result shape.
- `src/app/askUserBridge.ts` — generation-scoped bridge whose provisioning failure must be safe.

### Dependent Files
- `src/config/configLoader.ts` — continues supplying `ResolvedAgentConfig` while rejecting unknown user fields.
- `src/core/explorePolicy.ts` — consumes attestation facts through protocol-free accepted snapshots.
- `src/store/appStore.ts` — accepts only atomically admitted registration.
- `src/agent/agentConnection.ts` — existing ACP `newSession` seam receives filtered MCP declarations.
- `src/app/controller.test.ts` — controller fake/connection assertions for no-side-effect denials and accepted launches.

### Related ADRs
- [ADR-001: Fail Closed with an Attestable Fixed Explore Profile](adrs/adr-001.md) — defines no-warning, no-fallback eligibility.
- [ADR-004: Gate Explore Launches on Provider-Specific Capability Attestation](adrs/adr-004.md) — defines closed exact evidence and MCP isolation.
- [ADR-005: Reserve Explore Capacity Atomically at Child Registration](adrs/adr-005.md) — requires admission before child creation.
- [ADR-006: Verify the Explore Contract Through Layered Tests](adrs/adr-006.md) — requires injected evidence and controller integration proof.

## Deliverables

- New closed explore-capability verifier with no shipping eligible provider until evidence exists.
- Typed controller action result for eligibility, capacity, bridge, and startup outcomes.
- Fresh attested child launch path that excludes inherited global external MCP and agent-control capability.
- Denial and cleanup behavior that leaves no connection, bridge, child, reservation, or prompt side effect.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for attested launch, denied launch, bridge failure, and MCP isolation **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Exact complete restricted evidence is accepted only when provider, command, ordered arguments, environment, and runtime version all match.
  - [x] Unknown provider/release, changed command/argument/environment, stale version, and claims allowing write, shell, recursion, external MCP, or agent control deny with a closed reason.
  - [x] User-authored configuration attempts to declare explore safety or attestation remain strict-config errors or exact-evidence mismatches.
  - [x] The production verifier has no eligible default provider until reviewed evidence is introduced.
- Integration tests:
  - [x] Missing/stale evidence creates no connection, bridge route, ACP session, child snapshot, reservation, or prompt.
  - [x] Injected accepted evidence launches with a fresh attested recipe and exactly one generation-scoped `kitten-ask-user` declaration while configured external MCP names are absent.
  - [x] Scoped bridge registration failure and capacity denial leave no runnable child and clean any temporary bridge state.
  - [x] Ordinary sessions retain their existing resolved global MCP plus question bridge behavior.
  - [x] A stale generation cannot turn a denied or failed launch into a running child.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- No unverified runtime can start an `explore` child or inherit parent authority.
- Every eligible child receives only the scoped built-in question bridge.
