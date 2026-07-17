---
status: completed
title: Strict Editor Preference Config and Atomic Persistence
type: backend
complexity: medium
---

# Task 4: Strict Editor Preference Config and Atomic Persistence

## Overview

Extend the user config model with a strict editor preference and preserve it through the existing atomic read-merge-validate-write path. This makes the settings choice durable while retaining all unrelated user configuration.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- Config MUST use a strict discriminated editor preference: `system-default` or custom executable plus argument vector.
- A custom preference MUST be rejected unless its arguments contain exactly one full `{file}` placeholder.
- Missing editor configuration MUST resolve to system default without changing existing config defaults.
- Atomic writes MUST merge the editor patch with freshly read unrelated config and reject invalid serialized bytes before mutation.
</requirements>

## Subtasks

- [x] 4.1 Add the closed editor preference schema and default resolution.
- [x] 4.2 Validate exact placeholder cardinality and reject unknown keys.
- [x] 4.3 Include editor data in user-config parse, merge, and resolved application config.
- [x] 4.4 Preserve editor data through atomic patch writes without overwriting unrelated fields.
- [x] 4.5 Add loader and writer coverage for valid, invalid, and concurrent-field cases.

## Implementation Details

Follow the TechSpec “Configuration Contract,” “Runtime Configuration Reload,” and “Security and Privacy” sections. Reuse the existing strict Zod and atomic persistence conventions rather than introducing a second writer or a permissive parser.

### Relevant Files

- `src/config/configLoader.ts` — strict application and user-config schemas plus default resolution.
- `src/config/configLoader.test.ts` — current malformed-config and default behavior coverage.
- `src/config/configWriter.ts` — atomic read-merge-validate-write implementation.
- `src/config/configWriter.test.ts` — atomic merge and rejection test conventions.

### Dependent Files

- `src/index.ts` — will persist explicit setting changes and apply watcher reloads.
- `src/app/externalEditor.ts` — consumes the validated preference form.
- `src/ui/SettingsView.tsx` — renders a local draft from this config contract.

### Related ADRs

- [ADR-004: Persist editor preferences as validated direct argument vectors](adrs/adr-004.md) — mandates the discriminated direct-argv contract.

## Deliverables

- Strict editor preference schema, default, resolved config, and atomic persistence behavior.
- Loader and writer tests for schema safety and merge preservation.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for persisted configuration behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] An absent editor block resolves to `system-default`.
  - [x] A valid custom executable with exactly one full `{file}` placeholder loads successfully.
  - [x] Repeated, partial, or missing placeholders and unknown keys produce a config error.
  - [x] Writing an editor patch preserves provider, theme, statusline, and other existing fields.
  - [x] Invalid serialized editor data fails before a target file is created or replaced.
- Integration tests:
  - [x] An atomic editor save can be reloaded as the same validated preference.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Only validated direct-argv editor preferences enter runtime configuration.
- Editor writes preserve unrelated user configuration atomically.
