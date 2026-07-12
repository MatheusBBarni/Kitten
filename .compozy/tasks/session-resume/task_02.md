---
status: completed
title: "Run store: record type and one-file-per-run I/O"
type: backend
complexity: high
dependencies: []
---

# Task 02: Run store: record type and one-file-per-run I/O

## Overview
The run store is the persistence subsystem: it defines the small on-disk record for a cockpit run and reads, writes, lists, and deletes those records.
It stores only pointers plus the curated bundle (never transcripts), one JSON file per run under XDG state, so a later restore can rehydrate transcripts live from each agent.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST define `PersistedRunRecord`, `PersistedAgent`, and `PersistedRunSummary` per the TechSpec "Core Interfaces" section; the record MUST NOT include `SessionState.turns` or any derived field.
- MUST provide `createRunStore({ enabled, path? })` returning a `RunStore` with `save`, `list`, `load`, `delete`, `deleteAll`, and `flush`.
- MUST resolve the base directory with the same XDG-state logic as `resolveTelemetryPath`, honoring a `KITTEN_SESSIONS_PATH` override, and place each run at `<base>/sessions/<project>/<runId>.json` where `<project>` is a deterministic encoding of the absolute `cwd`.
- MUST write atomically (write a temp file then rename) so a crash mid-write cannot leave a torn record.
- MUST redact every persisted free-text field (for example `lastPrompt`) through `createSecretRedactor` before writing; the `HandoffBundle` arrives already redacted.
- MUST behave as a no-op when `enabled` is `false`: open no file, write nothing, and return an empty list, mirroring the telemetry `NOOP_RECORDER`.
- `list(cwd)` MUST return summaries for the given project only, sorted by `updatedAt` descending.

## Subtasks
- [ ] 2.1 Define the record, agent, and summary types
- [ ] 2.2 Resolve the sessions base path and encode the project directory deterministically
- [ ] 2.3 Implement atomic `save` with redaction of persisted free-text
- [ ] 2.4 Implement `list`, `load`, `delete`, and `deleteAll`
- [ ] 2.5 Implement the disabled no-op store and `flush`
- [ ] 2.6 Cover the round trip, redaction, sorting, deletion, and disabled behavior in tests

## Implementation Details
Create `src/persistence/runRecord.ts` (types) and `src/persistence/runStore.ts` (the store).
Reuse the XDG-state path resolution from `src/telemetry/recorder.ts` (`resolveTelemetryPath`) rather than reimplementing it, and the redactor from `src/core/secretRedactor.ts`.
See the TechSpec "Core Interfaces" and "Data Models" sections for the exact shapes, and ADR-003 for the storage decision.

### Relevant Files
- `src/telemetry/recorder.ts` — `resolveTelemetryPath`, `createJsonlFileSink`, and the disabled `NOOP_RECORDER` pattern to mirror
- `src/core/secretRedactor.ts` — `createSecretRedactor().redact(text)` for persisted free-text
- `src/core/types.ts` — `HandoffBundle`, `AgentId`, `AgentStatus` used in the record

### Dependent Files
- `src/persistence/runWriter.ts` — task_03 calls `save`
- `src/app/controller.ts` — task_07 calls `load` to restore a record
- `src/ui/SessionPicker.tsx` — task_09 calls `list`; task_10 calls `delete`/`deleteAll`

### Related ADRs
- [ADR-003: Cockpit-Run Persistence](../adrs/adr-003.md) — one JSON file per run, atomic, redacted, deletable
- [ADR-004: Live Restore via loadSession Replay](../adrs/adr-004.md) — the record stores pointers + bundle, transcripts rehydrate live

## Deliverables
- `src/persistence/runRecord.ts` exporting the record, agent, and summary types
- `src/persistence/runStore.ts` exporting `createRunStore` and the `RunStore` interface
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test performing a full save → list → load → delete round trip against a temp directory **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `save(record)` writes `<base>/sessions/<project>/<runId>.json` and `load(cwd, runId)` returns an equal record
  - [ ] `list(cwd)` returns only that project's runs, sorted by `updatedAt` descending
  - [ ] a record whose `lastPrompt` contains a token-shaped string is stored with it redacted
  - [ ] the record on disk contains no `turns` field
  - [ ] `delete(cwd, runId)` unlinks only that run; other runs remain
  - [ ] `deleteAll()` clears the sessions tree and subsequent `list` returns `[]`
  - [ ] `createRunStore({ enabled: false })` writes no file and `list` returns `[]`
  - [ ] a simulated failure during write leaves no partial file at the final path (temp-then-rename)
- Integration tests:
  - [ ] full save → list → load → delete round trip against an injected temp directory
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Records persist as one atomic JSON file per run under XDG state, scoped by project
- No transcript or derived state is ever written; free-text is redacted
- The disabled store is a true no-op
