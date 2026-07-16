---
status: completed
title: Migrate Controller and Boot Config Fixtures
type: test
complexity: low
---

# Task 04: Migrate Controller and Boot Config Fixtures

## Overview

Migrate direct controller and readiness AppConfig test fixtures to the new resolved default-off contract. This keeps existing controller, readiness, and boot behavior unchanged while allowing the strict config field to typecheck across its consumer family.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add transcriptWindowingEnabled: false to every scoped complete AppConfig literal.
2. MUST preserve existing provider, session, shell, persistence, telemetry, theme, and statusline values.
3. MUST leave derived spread fixtures inherited rather than adding redundant overrides.
4. MUST not change controller, boot, first-run, reducer, or production config behavior.
5. MUST verify first-run guidance and boot fixtures that already use defaults remain unchanged.
</requirements>

## Subtasks

- [ ] Update complete controller test configs with the explicit disabled value.
- [ ] Update the shared readiness AppConfig fixture.
- [ ] Audit first-run and boot fixture paths for inherited/default behavior without churn.
- [ ] Run focused controller, readiness, first-run, and boot suites.

## Implementation Details

Modify only the direct fixture literals in src/app/controller.test.ts and src/config/readiness.test.ts. Audit src/config/firstRun.test.ts and test/firstRunBoot.test.ts as no-change boundaries. Reference the TechSpec Impact Analysis and task 03 config contract.

### Relevant Files

- src/app/controller.test.ts — direct controller and initial-task config literals.
- src/config/readiness.test.ts — shared complete readiness fixture.
- src/config/firstRun.test.ts — guidance-only no-change boundary.
- test/firstRunBoot.test.ts — resolved-default boot no-change boundary.

### Dependent Files

- src/core/types.ts — task 03 makes the resolved field required.
- src/config/configLoader.ts — task 03 resolves false by default.

### Related ADRs

- [ADR-001: Ship a flagged bounded live transcript projection](adrs/adr-001.md) — Requires default-off behavior.
- [ADR-004: Use strict config, canonical commands, and bounded evidence](adrs/adr-004.md) — Defines the strict config contract.

## Deliverables

- Migrated controller and readiness typed fixtures.
- Focused consumer-family regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Boot/config integration tests **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] src/app/controller.test.ts retains controller startup, resilience, and disposal behavior with the feature disabled.
  - [ ] src/config/readiness.test.ts retains valid resolved readiness configs.
  - [ ] src/config/firstRun.test.ts remains independent of the new AppConfig field.
- Integration tests:
  - [ ] test/firstRunBoot.test.ts continues to consume the resolved false default.
  - [ ] Typecheck finds no stale complete AppConfig literal in this family.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every direct fixture in the scoped family declares the disabled value.
- Existing controller and boot semantics are unchanged.
