---
status: pending
title: "Atomic delta config write-back"
type: backend
complexity: medium
dependencies:
  - task_01
---

# Task 04: Atomic delta config write-back

## Overview
Add the first path that writes user config to disk: persist a single changed field into the delta file without clobbering hand-edited keys.
The write must be safe enough that a crash mid-write or an invalid value can never leave Kitten unable to start.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `persistUserConfig(patch, options?)` in a new `src/config/configWriter.ts` that re-reads the on-disk user config, applies only the patched keys, and writes the result.
- MUST validate the serialized result against `USER_CONFIG_SCHEMA` before committing and reject without writing on failure.
- MUST write atomically: write a temp file in the target directory then rename over the target, creating the parent directory if absent.
- MUST preserve keys the patch does not set (for example a hand-added agent override or the telemetry flag).
- MUST resolve the path via `resolveConfigPath` honoring `KITTEN_CONFIG`, with an injectable path/env for tests.
</requirements>

## Subtasks
- [ ] 4.1 Create `configWriter.ts` and the `persistUserConfig` signature with injectable path/env
- [ ] 4.2 Read-modify the existing delta file, applying only the patched keys
- [ ] 4.3 Validate the merged deltas against the strict schema before any write
- [ ] 4.4 Write to a temp file and rename over the target, creating the parent directory
- [ ] 4.5 Cover key preservation, validation rejection, and atomicity in tests

## Implementation Details
Create `src/config/configWriter.ts`.
Reuse `resolveConfigPath`, `USER_CONFIG_SCHEMA`, and the `UserConfig` type from `configLoader.ts`, and follow the `recorder.ts` precedent for `mkdirSync` and path resolution, but use rename-based atomicity rather than an append.
See the TechSpec "Core Interfaces" (configWriter) section and ADR-004; the writer serializes the delta shape, not the merged `AppConfig`.

### Relevant Files
- `src/config/configWriter.ts` — new; the atomic delta writer
- `src/config/configLoader.ts` — reuse `resolveConfigPath`, `USER_CONFIG_SCHEMA`, `UserConfig`
- `src/telemetry/recorder.ts` — precedent for `mkdirSync` and XDG path resolution

### Dependent Files
- `src/index.ts` — task_09 calls `persistUserConfig` from the persistence subscriber
- `src/config/configWriter.test.ts` — new

### Related ADRs
- [ADR-004: Reactive, persisted configuration](../adrs/adr-004.md) — atomic, delta-preserving write-back

## Deliverables
- `persistUserConfig` performing a validated, atomic, delta-preserving write
- Injectable path/env seams for testing against temp files
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test round-tripping a theme delta through write then load **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] persisting `{ theme: "dark" }` into a file that also carries a `telemetryEnabled` delta keeps `telemetryEnabled`
  - [ ] the written file re-parses through `loadAppConfig` without error
  - [ ] an invalid patch (e.g. `theme: "neon"`) throws and leaves the original file byte-for-byte untouched
  - [ ] writing to a non-existent directory creates it and succeeds
  - [ ] no temp/partial file remains after a successful write
- Integration tests:
  - [ ] `persistUserConfig` then `loadAppConfig` round-trips a theme delta against a real temp file
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Writes are atomic, schema-validated, and preserve unmodeled keys
- A failed write never corrupts the existing config file
