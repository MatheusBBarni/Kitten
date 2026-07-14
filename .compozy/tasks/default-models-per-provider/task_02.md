---
status: pending
title: "Migrate the first typed-fixture group to the new config shape"
type: refactor
complexity: medium
---

# Task 2: Migrate the first typed-fixture group to the new config shape

## Overview

Update the first bounded group of explicit AppConfig fixtures with the resolved empty provider-defaults map. This preserves compilation during the staged type migration without changing runtime behavior or fixture scenarios.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. Every explicit AppConfig fixture in scope MUST add providerDefaults: {} without changing providers, sessions, telemetry, or assertions.
- 2. Existing test names and scenario semantics MUST remain unchanged.
- 3. This task MUST not finalize requiredness; it only prepares the bounded compatibility group.
- 4. Targeted suites and TypeScript compilation MUST remain clean.
</requirements>

## Subtasks

- [ ] 2.1 Locate the first explicit AppConfig fixture group.
- [ ] 2.2 Add the empty defaults map to every fixture.
- [ ] 2.3 Preserve controller and overlay scenario behavior.
- [ ] 2.4 Verify targeted suites and compilation.

## Implementation Details

Perform the fixture-only compatibility migration from TechSpec Impact Analysis. Do not change production default-application behavior.

### Relevant Files

- src/app/controller.test.ts — shared APP_CONFIG and multi-session fixtures.
- src/ui/ApprovalPrompt.test.tsx — approval and fleet AppConfig literals.
- src/ui/ModelSelect.test.tsx — picker AppConfig fixture.

### Dependent Files

- src/core/types.ts — staged provider-defaults member.
- src/config/configLoader.ts — resolved runtime empty map.
- src/config/readiness.test.ts and integration fixtures — final compatibility batch.

### Related ADRs

- [ADR-003: Keep provider defaults declarative and controller-owned](adrs/adr-003.md) — first-class preference shape.

## Deliverables

- Three fixture files explicitly declare providerDefaults: {}.
- Existing fixture behavior and assertions remain intact.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for typed configuration compatibility **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Run controller fixture scenarios without changing multi-session expectations.
  - [ ] Run approval overlay scenarios without changing permission behavior.
  - [ ] Run model-picker rendered scenarios without changing selector behavior.
- Integration tests:
  - [ ] Run bun run typecheck and confirm this fixture group is compatible.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every migrated literal explicitly supplies the empty defaults map.
- No production behavior changes.
