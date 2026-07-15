---
status: pending
title: Migrate Runtime Integration Config Fixtures
type: test
complexity: low
---

# Task 06: Migrate Runtime Integration Config Fixtures

## Overview

Migrate direct AppConfig literals in the runtime integration family after task 03 makes the resolved experiment field required. Default-spread helpers remain unchanged, proving disabled behavior continues without redundant overrides.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add transcriptWindowingEnabled: false to the two direct ask-user MCP literals and delegated-orchestration literal.
2. MUST leave defaultAppConfig spread helpers unchanged in clarification, cockpit-session, and index integrations.
3. MUST retain existing runtime ordering, child-answer, startup, and orchestration assertions.
4. MUST not add enabled fixtures, feature assertions, environment controls, or production changes.
</requirements>

## Subtasks

- [ ] Audit the five named runtime integration fixtures.
- [ ] Add the explicit disabled value to both ask-user MCP fixtures.
- [ ] Add the explicit disabled value to the orchestration fixture.
- [ ] Confirm default-spread helpers inherit false without redundant changes.
- [ ] Run focused integrations and typecheck.

## Implementation Details

Modify test/askUserMcp.integration.test.ts and test/orchestration.integration.test.ts. Audit test/clarificationLifecycle.integration.test.tsx, test/cockpitSession.test.ts, and test/index.integration.test.tsx as inherited-default boundaries. Use task 03's config contract; no transcript feature behavior belongs here.

### Relevant Files

- test/askUserMcp.integration.test.ts — two direct runtime config literals.
- test/orchestration.integration.test.ts — direct delegated-orchestration literal.
- test/clarificationLifecycle.integration.test.tsx — inherited default boundary.
- test/cockpitSession.test.ts — inherited default boundary.
- test/index.integration.test.tsx — inherited default boundary.

### Dependent Files

- src/core/types.ts — task 03 required field.
- src/config/configLoader.ts — task 03 false default.

### Related ADRs

- [ADR-001: Ship a flagged bounded live transcript projection](adrs/adr-001.md) — Requires disabled behavior to preserve current runtime flows.
- [ADR-004: Use strict config, canonical commands, and bounded evidence](adrs/adr-004.md) — Defines the strict feature gate.

## Deliverables

- Migrated direct runtime integration fixtures.
- Audited inherited-default helpers with no redundant changes.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Runtime integration tests **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Typecheck validates direct runtime config literals against required AppConfig.
- Integration tests:
  - [ ] askUserMcp retains child-answer continuation and concurrent ordering with the feature disabled.
  - [ ] orchestration retains delegated launch, prompt, running state, and child interaction order.
  - [ ] clarificationLifecycle, cockpitSession, and index integrations retain default-spread compatibility.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Direct fixtures explicitly disable windowing and inherited helpers remain unchanged.
- Existing runtime integration behavior is preserved.
