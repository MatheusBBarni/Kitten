---
status: pending
title: "Config file-watcher with debounced reload"
type: backend
complexity: medium
dependencies:
  - task_01
---

# Task 05: Config file-watcher with debounced reload

## Overview
Watch the config file and report a reloaded configuration on external change, so a hand-edit can reconcile into the running app.
The watcher is debounced and tolerant of a transient mid-edit parse failure, so it never crashes or thrashes on a partial write.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `watchUserConfig(onConfig, options?)` in a new `src/config/configWatcher.ts` returning a `ConfigWatcher` with a `close()` method.
- MUST debounce rapid events and always re-read the file rather than trust the event payload, reacting to both `change` and `rename` events.
- MUST call `onConfig` with the freshly loaded `AppConfig` only when the file parses successfully.
- MUST swallow a transient parse or read failure without throwing and without calling `onConfig`.
- MUST resolve the path via `resolveConfigPath`/`KITTEN_CONFIG`, with an injectable path, env, and debounce interval for tests.
</requirements>

## Subtasks
- [ ] 5.1 Create `configWatcher.ts` and the `watchUserConfig` signature returning a `ConfigWatcher`
- [ ] 5.2 Watch the resolved path, handling both `change` and `rename` events
- [ ] 5.3 Debounce events and reload via `loadAppConfig`
- [ ] 5.4 Ignore transient parse/read failures without emitting
- [ ] 5.5 Cover reload, debounce, invalid-file tolerance, and `close()` in tests

## Implementation Details
Create `src/config/configWatcher.ts` using the Node `fs.watch` API, reusing `loadAppConfig` for the reload and `resolveConfigPath` for the path.
See the TechSpec "Integration Points" (file-watch caveats) section and ADR-004.
The store-level idempotence that breaks the write-reload loop is task_09; this task only surfaces the reloaded config.

### Relevant Files
- `src/config/configWatcher.ts` — new; the debounced watcher
- `src/config/configLoader.ts` — `loadAppConfig`, `resolveConfigPath`

### Dependent Files
- `src/index.ts` — task_09 wires the watcher into the store
- `src/config/configWatcher.test.ts` — new

### Related ADRs
- [ADR-004: Reactive, persisted configuration](../adrs/adr-004.md) — the file-watcher as the reconciliation path

## Deliverables
- `watchUserConfig` with debounced reload, rename handling, and parse-error tolerance
- Injectable path/env/debounce seams for deterministic tests
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test asserting an external theme change surfaces through `onConfig` **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] an external write to the watched file triggers exactly one `onConfig` after the debounce window
  - [ ] `onConfig` receives the `AppConfig` reflecting the new file contents
  - [ ] writing invalid JSON does not throw and does not call `onConfig`; the next valid write does
  - [ ] `close()` stops all further `onConfig` callbacks
  - [ ] a temp-file-plus-rename replacement is detected and reloads
- Integration tests:
  - [ ] watch a temp file, write a theme change, and assert `onConfig` fires with the new theme
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- External edits surface as reloaded config; invalid mid-edits are ignored
- `close()` fully detaches the watcher
