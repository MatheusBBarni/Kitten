---
status: completed
title: Core capability-composition contract
type: backend
complexity: medium
---

# Task 01: Core capability-composition contract

## Overview

Create the pure, protocol-free contract that turns a closed capability snapshot into reviewed static harness blocks and content-free selection metadata. This establishes a default-deny V1 catalog so an unknown or unavailable capability remains a valid base-only result rather than a false claim.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. MUST add a closed, protocol-free capability context and composition result in the core layer, with no provider identity, ACP/session identifiers, bridge declaration data, paths, user or repository content, environment values, or raw errors.
- 2. MUST select the single reviewed V1 Kitten MCP bridge and child-control fragment only for a confirmed bridge-child-control fact; absent, unknown, stale, or conflicting facts MUST select no optional block.
- 3. MUST keep the catalog static, deterministic, and bounded by the existing renderer contract; future capability families MUST remain block-free in V1 even when their closed facts are present.
- 4. MUST return only stable fragment identifiers, selected count, contract version, base-only state, and reviewed static blocks; it MUST not perform I/O, lifecycle inspection, delivery, telemetry, persistence, or ACP work.
</requirements>

## Subtasks

- [ ] 1.1 Define the closed capability and composition contracts in the pure core layer.
- [ ] 1.2 Add the reviewed static V1 catalog entry and default-deny selection behavior.
- [ ] 1.3 Cover the confirmed, base-only, stale, conflicting, and future-capability matrix.
- [ ] 1.4 Prove deterministic ordering, immutability, allowed result shape, and source-boundary purity.
- [ ] 1.5 Verify the selected static block remains valid within the existing renderer limits.

## Implementation Details

See TechSpec sections “Core Interfaces”, “Data Models”, and “Testing Strategy”. Keep capability selection separate from the renderer's static-block validation and from controller lifecycle discovery.

### Relevant Files

- `src/core/harnessCapabilityComposition.ts` — new pure closed-vocabulary composer and static V1 catalog.
- `src/core/harnessCapabilityComposition.test.ts` — new matrix, golden, privacy-shape, immutability, and source-boundary coverage.
- `src/core/harnessPrompt.test.ts` — proves composed static output remains accepted and bounded by the existing renderer.
- `src/core/harnessPrompt.ts` — supplies the existing `HarnessBlock` and prompt-version contract; it remains unaware of capability facts.

### Dependent Files

- `src/app/controller.ts` — will consume only the exported protocol-free contracts while retaining lifecycle ownership.
- `src/agent/agentConnection.ts` — will receive the rendered explicit envelope without importing the composer.

### Related ADRs

- [ADR-001: Compose Fresh Harnesses from Confirmed Capability Snapshots](adrs/adr-001.md) — defines the default-deny fresh-snapshot policy and valid base-only fallback.
- [ADR-003: Compose Capabilities in Core and Make the Adapter Envelope-Only](adrs/adr-003.md) — assigns static composition to the pure core boundary.

## Deliverables

- A new pure capability-composition module with a closed context, deterministic V1 catalog, and content-free result.
- Colocated matrix and boundary tests covering V1 selection and safe base-only outcomes.
- Renderer compatibility coverage for the composed fragment and existing extension bounds.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for composed-block rendering **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] A confirmed V1 bridge-child-control fact selects exactly the stable Kitten MCP fragment and reports one selected fragment with `baseOnly` false.
  - [ ] Unknown, absent, stale, and conflicting bridge facts each return no blocks and `baseOnly` true.
  - [ ] Confirmed clarification, role, managed-workspace, steering, and handoff facts remain block-free in V1.
  - [ ] Frozen equivalent contexts, including different generation values, produce identical ordered output without mutation.
  - [ ] The result and production source omit dynamic/private fields and prohibited layer, I/O, timer, telemetry, persistence, and ACP references.
- Integration tests:
  - [ ] Rendering the selected V1 block through `renderHarnessPrompt` succeeds, preserves the static fragment identity, and remains under the eight-block and 800-extension-token limits.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The core composer is deterministic, protocol-free, and default-deny for every non-confirmed or inactive V1 capability.
- The existing base renderer remains the sole owner of prompt validation, ordering, and size limits.

