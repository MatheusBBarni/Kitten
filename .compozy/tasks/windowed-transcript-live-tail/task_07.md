---
status: pending
title: Migrate Session Shell and Telemetry Config Fixtures
type: test
complexity: low
---

# Task 07: Migrate Session Shell and Telemetry Config Fixtures

## Overview

Migrate the remaining direct session, shell, and telemetry AppConfig fixtures to the default-off experiment contract. This preserves session restoration, shell, tab, and telemetry behavior while completing the typed consumer migration needed for the feature branch.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add transcriptWindowingEnabled: false to direct session-status, shell-runtime, and telemetry helper config literals.
2. MUST preserve every existing session, shell, persistence, and telemetry setting.
3. MUST leave the tab fixture unchanged when it inherits false through defaultAppConfig.
4. MUST not couple the new flag to telemetryEnabled or create an enabled windowing fixture.
5. MUST not modify production session, shell, or recorder code.
</requirements>

## Subtasks

- [ ] Update the session-status AppConfig fixture.
- [ ] Update the shell-runtime controller config fixture.
- [ ] Update the telemetry clarification config helper independently of telemetry opt-in.
- [ ] Verify the session-tabs helper inherits the false default without an override.
- [ ] Run focused integrations and typecheck.

## Implementation Details

Modify test/sessionStatus.integration.test.tsx, test/shellRuntime.integration.test.ts, and test/telemetry.integration.test.ts. Audit test/sessionTabs.integration.test.tsx as an inherited-default no-change boundary. Reference task 03 and the TechSpec Impact Analysis.

### Relevant Files

- test/sessionStatus.integration.test.tsx — direct status fixture.
- test/shellRuntime.integration.test.ts — direct shell fixture.
- test/telemetry.integration.test.ts — telemetry clarification config helper.
- test/sessionTabs.integration.test.tsx — inherited-default tab fixture.

### Dependent Files

- src/core/types.ts — task 03 required resolved field.
- src/config/configLoader.ts — task 03 default-false behavior.
- src/telemetry/recorder.ts — task 10 changes this later; keep it untouched here.

### Related ADRs

- [ADR-001: Ship a flagged bounded live transcript projection](adrs/adr-001.md) — Requires default-off continuity.
- [ADR-004: Use strict config, canonical commands, and bounded evidence](adrs/adr-004.md) — Defines the config gate and telemetry separation.

## Deliverables

- Migrated direct session, shell, and telemetry fixture literals.
- Audited session-tab inherited-default boundary.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Session/shell/telemetry integration tests **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Typecheck validates each migrated complete config literal.
- Integration tests:
  - [ ] sessionStatus preserves end-turn status and visible-tab behavior.
  - [ ] sessionTabs retains lifecycle, persistence, restore, and unavailable-history behavior through its inherited default.
  - [ ] shellRuntime retains integrated-shell launch and snapshot behavior.
  - [ ] telemetry enabled/disabled paths remain independent of the windowing flag.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every direct scoped fixture explicitly disables the experiment.
- Session, shell, and telemetry behavior remains unchanged before task 10.
