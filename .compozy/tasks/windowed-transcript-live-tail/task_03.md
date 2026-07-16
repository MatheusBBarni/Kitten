---
status: completed
title: Add the Strict Default-Off Configuration Contract
type: frontend
complexity: high
---

# Task 03: Add the Strict Default-Off Configuration Contract

## Overview

Introduce the resolved transcriptWindowingEnabled configuration field that gates the experiment without adding a Settings control, environment override, or persistence behavior. The contract defaults to false, validates strictly, preserves explicit false, and documents the opt-in scope.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add required AppConfig.transcriptWindowingEnabled and optional strict UserConfig.transcriptWindowingEnabled.
2. MUST resolve omitted configuration to false and preserve explicit true and false through nullish merge behavior.
3. MUST reject non-boolean values with a hard ConfigError that names transcriptWindowingEnabled.
4. MUST prove user-config writes preserve both boolean deltas across unrelated writes.
5. MUST document the JSON opt-in and default-off experimental scope.
6. MUST add no environment override, Settings UI, watcher behavior, or transcript persistence change.
</requirements>

## Subtasks

- [ ] Add the resolved type, strict user-schema field, default, and merge behavior.
- [ ] Cover omitted, true, false, malformed, and file-loaded configuration paths.
- [ ] Cover atomic user-config round trips and unrelated root-field preservation.
- [ ] Document the opt-in JSON field and live-run experimental boundary.
- [ ] Leave direct consumer fixture migration to tasks 04-07.

## Implementation Details

Modify src/core/types.ts, src/config/configLoader.ts, src/config/configLoader.test.ts, src/config/configWriter.test.ts, test/configPersistence.integration.test.ts, and README.md. Reference the TechSpec Integration Points and ADR-004. Do not change configWriter production code unless current root-delta behavior demonstrably fails.

### Relevant Files

- src/core/types.ts — resolved AppConfig contract.
- src/config/configLoader.ts — strict schema, default, and merge.
- src/config/configLoader.test.ts — default and validation patterns.
- src/config/configWriter.test.ts — persisted root-delta behavior.
- test/configPersistence.integration.test.ts — atomic preservation boundary.
- README.md — discoverable config-only opt-in guidance.

### Dependent Files

- src/app/controller.test.ts — task 04 migrates direct controller fixtures.
- src/ui/ApprovalPrompt.test.tsx — task 05 migrates UI fixtures.
- test/askUserMcp.integration.test.ts — task 06 migrates runtime fixtures.
- test/sessionStatus.integration.test.tsx — task 07 migrates session/telemetry fixtures.

### Related ADRs

- [ADR-001: Ship a flagged bounded live transcript projection](adrs/adr-001.md) — Establishes default-off scope.
- [ADR-002: Launch bounded live history as a truth-first experiment](adrs/adr-002.md) — Defines the opt-in rollout.
- [ADR-004: Use strict config, canonical commands, and bounded evidence](adrs/adr-004.md) — Chooses strict config over Settings or environment control.

## Deliverables

- Resolved default-false config contract and strict user delta.
- Loader, writer, integration, and documentation coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Config persistence integration tests **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] defaultAppConfig, empty JSON, and absent-file loading resolve false.
  - [ ] Explicit true and explicit false both survive parsing and merge.
  - [ ] String, numeric, and null values fail with a field-naming ConfigError.
  - [ ] Writer round-trips true and false and preserves either through an unrelated patch.
- Integration tests:
  - [ ] Config persistence preserves the new root delta atomically with unrelated preferences.
  - [ ] Focused config tests leave disabled behavior as the resolved default.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Omitted configuration always resolves false.
- No configuration surface beyond the validated user JSON field is introduced.
