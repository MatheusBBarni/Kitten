---
status: pending
title: Migrate UI Config Fixtures
type: test
complexity: medium
---

# Task 05: Migrate UI Config Fixtures

## Overview

Migrate the direct AppConfig fixtures used by approval, handoff-preview, and model-selection UI suites. The work keeps current UI scenarios intact with the experiment explicitly disabled and avoids adding a UI toggle before the feature exists.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add transcriptWindowingEnabled: false to all four scoped complete UI AppConfig literals.
2. MUST preserve each fixture's agent, session, shell, persistence, telemetry, theme, and statusline values.
3. MUST update the custom two-session approval config explicitly instead of relying on a shared fixture.
4. MUST not enable transcript windowing, add casts, add local toggles, or change UI production behavior.
</requirements>

## Subtasks

- [ ] Update the shared approval test config.
- [ ] Update the approval same-provider/two-session config.
- [ ] Update handoff-preview and model-selection configs.
- [ ] Run scoped UI suites and typecheck.

## Implementation Details

Modify src/ui/ApprovalPrompt.test.tsx, src/ui/HandoffPreview.test.tsx, and src/ui/ModelSelect.test.tsx only. Follow task 03's config contract and TechSpec Impact Analysis; task 08 later changes ConversationView separately.

### Relevant Files

- src/ui/ApprovalPrompt.test.tsx — shared and two-session direct fixtures.
- src/ui/HandoffPreview.test.tsx — handoff preview fixture.
- src/ui/ModelSelect.test.tsx — model-selection fixture.

### Dependent Files

- src/core/types.ts — task 03 resolved config type.
- src/config/configLoader.ts — task 03 default and schema.
- src/ui/CockpitApp.tsx — exercised by the migrated UI setups but unchanged here.

### Related ADRs

- [ADR-001: Ship a flagged bounded live transcript projection](adrs/adr-001.md) — Defines disabled rollout behavior.
- [ADR-004: Use strict config, canonical commands, and bounded evidence](adrs/adr-004.md) — Defines the strict default-off field.

## Deliverables

- Four migrated UI fixture literals across three suites.
- Focused UI regressions preserving disabled behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- UI integration tests **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] ApprovalPrompt mounts shared and two-session mock-agent setups with the explicit false flag.
  - [ ] HandoffPreview mounts its controller setup with the explicit false flag.
  - [ ] ModelSelect mounts its controller setup with the explicit false flag.
- Integration tests:
  - [ ] Existing approval routing, handoff flow, and model-selection scenarios remain unchanged.
  - [ ] Typecheck accepts all scoped complete UI AppConfig literals.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- All scoped UI fixtures explicitly disable the experiment.
- No UI behavior or toggle is introduced by the migration.
