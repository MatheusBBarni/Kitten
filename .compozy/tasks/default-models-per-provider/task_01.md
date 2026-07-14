---
status: pending
title: "Add transitional provider-default config and core result contract"
type: backend
complexity: high
---

# Task 1: Add transitional provider-default config and core result contract

## Overview

Add the strict user configuration shape for per-provider model and effort defaults and the protocol-free session result contract used by later layers. This creates a typechecking migration foundation while preserving user-authored config and reducer-only session state.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. The loader MUST accept a strict top-level providerDefaults map keyed only by known providers and resolve omission to an empty map.
- 2. Model and effort values MUST be non-empty strings; unknown providers, nested keys, types, and top-level keys MUST raise ConfigError.
- 3. AppConfig MAY use a temporary optional TypeScript member only during the fixture migration; resolved runtime config MUST always contain the empty map.
- 4. Core MUST define a protocol-free terminal result, session field, and reducer event without ACP types or config-options mutation.
- 5. README MUST document declarative model-and-effort-only configuration and state that Kitten never writes it.
</requirements>

## Subtasks

- [ ] 1.1 Add strict provider-default parsing and empty resolved defaults.
- [ ] 1.2 Define preference, result, session-state, and event contracts.
- [ ] 1.3 Add reducer initialization and replacement behavior.
- [ ] 1.4 Document a valid non-mutating configuration example.
- [ ] 1.5 Cover valid, invalid, merge, and reducer-state cases.

## Implementation Details

Follow TechSpec Data Models and Default Application Algorithm. Keep writer behavior untouched and treat optional typing only as the bounded migration bridge.

### Relevant Files

- src/config/configLoader.ts — strict schemas, defaults, merge, and ConfigError paths.
- src/config/configLoader.test.ts — loader and README example coverage.
- src/core/types.ts — AppConfig, domain events, and session state.
- src/core/sessionReducer.ts — sole SessionState writer.
- src/core/sessionReducer.test.ts — structural-sharing regressions.
- README.md — personal configuration guidance.

### Dependent Files

- src/app/actions.ts — later action consumes terminal results.
- src/store/selectors.ts — later result projection.
- src/config/configWatcher.ts — later validated-default consumer.

### Related ADRs

- [ADR-003: Keep provider defaults declarative and controller-owned](adrs/adr-003.md) — config ownership and no writer.
- [ADR-004: Sequence defaults from agent-confirmed model state](adrs/adr-004.md) — reducer-owned truthful result.

## Deliverables

- Strict provider-default parsing and defensive merge behavior.
- Protocol-free preference/result/session contracts.
- README example parsed by the real loader.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for configuration and reducer behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Parse model-only, effort-only, and combined defaults for each known provider.
  - [ ] Resolve omitted defaults to an empty map and prove merge does not retain mutable input references.
  - [ ] Reject unknown providers, keys, empty strings, and wrong types with field-specific ConfigError paths.
  - [ ] Replace only defaultApplyResult while retaining configOptions and unrelated state references.
- Integration tests:
  - [ ] Parse the marked README example with the real loader.
  - [ ] Confirm no-config boot retains resolved empty defaults.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every resolved AppConfig supplies provider defaults.
- No configuration writer path is added.
