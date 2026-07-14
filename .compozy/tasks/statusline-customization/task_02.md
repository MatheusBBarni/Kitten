---
status: pending
title: "Add Strict Statusline Config and Symlink-Safe Persistence"
type: backend
complexity: high
---

# Task 02: Add Strict Statusline Config and Symlink-Safe Persistence

## Overview

Extend Kitten's strict user configuration model to persist a disclosure acknowledgement and an optional declarative statusline layout. Preserve unrelated user settings during atomic writes while rejecting unsafe symlink targets before reading or replacing configuration.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a resolved statusline preference to `AppConfig` whose absent user-config state preserves the legacy footer and has no LLM acknowledgement.
- MUST extend the strict `UserConfig` schema with an optional statusline delta that permits acknowledgement-only persistence and requires separator and line together for a saved layout.
- MUST validate persisted layouts through the shared core contract, preserve strict unknown-key rejection, and merge statusline independently of unrelated configuration fields.
- MUST retain private same-directory atomic-write behavior while rejecting a pre-existing symlink at the config target before content is read or replaced.
- MUST never persist a natural-language request, raw LLM response, resolved path, branch, rendered line, or statusline-specific telemetry data.
</requirements>

## Subtasks

- [ ] 2.1 Extend resolved configuration and defaults with the legacy-compatible statusline preference.
- [ ] 2.2 Add strict user-config delta validation and field-level merge behavior for acknowledgement and optional layout.
- [ ] 2.3 Preserve unrelated root configuration keys during acknowledgement-only and complete-layout write patches.
- [ ] 2.4 Reject symlink targets before config reads or atomic replacements while retaining existing private permission behavior.
- [ ] 2.5 Add temporary-directory coverage for schema, merge, round-trip, preservation, and unsafe-target failures.

## Implementation Details

Implement the config boundary from TechSpec "Data Models" and "User config and watcher" integration guidance. Reuse the pure statusline validation instead of embedding another layout schema in the writer, and keep malformed existing config a hard error per the repository resilience rule.

### Relevant Files

- `src/core/types.ts` — extend resolved `AppConfig` with the statusline preference.
- `src/config/configLoader.ts` — add strict delta parsing, defaults, and merge behavior.
- `src/config/configLoader.test.ts` — verify default, strict parsing, and merge cases.
- `src/config/configWriter.ts` — preserve unrelated deltas, validate written bytes, and reject symlink targets before file access.
- `src/config/configWriter.test.ts` — exercise real temporary config paths, private writes, and failure preservation.

### Dependent Files

- `src/index.ts` — seeds the resolved preference and later passes acknowledged or confirmed patches to the writer.
- `src/config/configWatcher.ts` — reloads the expanded `AppConfig` shape for the active controller session.
- `src/store/appStore.ts` — receives the resolved preference after boot, write, and external reload.

### Related ADRs

- [ADR-001: Constrain V1 to declarative conversational statusline configuration](adrs/adr-001.md) — limits persisted data to the validated layout.
- [ADR-003: Persist a structured statusline preference and share one pure renderer](adrs/adr-003.md) — defines the optional delta, legacy default, and symlink-safe write requirement.

## Deliverables

- Strict resolved and user-config statusline support with a legacy-compatible default.
- Atomic acknowledgement and complete-layout patch persistence that preserves unrelated configuration.
- Symlink-target protection with regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for config persistence round-trips **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Parsing no `statusline` block yields an unacknowledged preference with a null layout.
  - [ ] Acknowledgement-only and complete-layout blocks parse and merge correctly.
  - [ ] A layout with only one of `separator` or `line`, an unknown nested key, an invalid item, or an invalid separator fails as a hard config error.
  - [ ] Merging a statusline delta retains provider, session, theme, shell, MCP, and telemetry settings.
  - [ ] A symlink config target causes persistence to reject before the target content changes.
- Integration tests:
  - [ ] A temporary config with unrelated settings survives acknowledgement-only then complete-layout atomic writes and reloads to the expected resolved preference with private file permissions.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Valid layouts survive a config round-trip without changing unrelated settings.
- Missing or malformed statusline configuration cannot silently change the active behavior or follow a symlink.
