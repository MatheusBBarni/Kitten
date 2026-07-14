---
status: pending
title: "Complete fixture migration and make provider defaults required"
type: refactor
complexity: high
---

# Task 3: Complete fixture migration and make provider defaults required

## Overview

Complete the remaining explicit AppConfig fixture migration and remove the temporary optional compatibility. After this task, AppConfig statically guarantees provider defaults and resolved configs still provide an empty map for users who omit the feature.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. AppConfig providerDefaults MUST become required only after each fixture in scope declares providerDefaults: {}.
- 2. Migrated fixtures MUST retain their provider, session, shell, telemetry, and assertion behavior.
- 3. Final typing MUST retain an explicit resolved empty map rather than reintroducing optional consumer handling.
- 4. The change MUST remain within the seven-file scope and pass the full TypeScript compilation gate.
</requirements>

## Subtasks

- [ ] 3.1 Migrate remaining readiness and UI config fixtures.
- [ ] 3.2 Migrate remaining integration config fixtures.
- [ ] 3.3 Finalize required AppConfig defaults typing.
- [ ] 3.4 Verify fixture behavior remains unchanged.
- [ ] 3.5 Run targeted suites, full typecheck, and full tests.

## Implementation Details

Finalize the TechSpec Data Models contract. This is a compatibility refactor only; do not add controller, watcher, or UI default-application behavior.

### Relevant Files

- src/core/types.ts — make providerDefaults required.
- src/config/readiness.test.ts — readiness APP_CONFIG.
- src/ui/HandoffPreview.test.tsx — handoff APP_CONFIG.
- test/telemetry.integration.test.ts — telemetry config fixture.
- test/sessionStatus.integration.test.tsx — session status APP_CONFIG.
- test/cockpitSession.test.ts — multi-directory config fixture.
- test/shellRuntime.integration.test.ts — shell runtime config fixture.

### Dependent Files

- src/config/configLoader.ts — already resolves empty defaults.
- src/store/selectors.ts and src/app/actions.ts — later consumers require final typing.

### Related ADRs

- [ADR-003: Keep provider defaults declarative and controller-owned](adrs/adr-003.md) — first-class configuration contract.

## Deliverables

- Required AppConfig provider-defaults type.
- Seven migrated typed fixtures with explicit empty maps.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for typed configuration compatibility **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Run readiness and handoff preview suites with existing configuration assertions.
  - [ ] Run session status and shell runtime suites with original expectations.
  - [ ] Run telemetry fixtures without adding any default-application event.
- Integration tests:
  - [ ] Run bun run typecheck after requiredness lands.
  - [ ] Run bun test src/config/readiness.test.ts src/ui/HandoffPreview.test.tsx test/telemetry.integration.test.ts test/sessionStatus.integration.test.tsx test/cockpitSession.test.ts test/shellRuntime.integration.test.ts.
  - [ ] Run the full bun test suite.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- AppConfig requires provider defaults and all typed fixtures comply.
- No transitional optional compatibility remains.
