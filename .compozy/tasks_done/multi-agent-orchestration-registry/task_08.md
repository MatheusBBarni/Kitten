---
status: completed
title: "Enforce Delegation Persistence and Telemetry Boundaries"
type: backend
complexity: high
---

# Task 8: Enforce Delegation Persistence and Telemetry Boundaries

## Overview

Enforce the V1 promise that delegation ownership never survives restart while ordinary child conversations retain their current persistence behavior. Add content-free local lifecycle telemetry for accepted delegated transitions without serializing task text, outcomes, identities, transcripts, paths, or provider errors.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST leave the persisted V2 run-record schema unchanged and exclude delegation graph, task/outcome, generations, close intent, and terminal delegation snapshots from every run snapshot.
2. MUST retain ordinary child conversation persistence while ensuring restored sessions begin with no delegation ownership or group lifecycle state.
3. MUST record only opt-in, local, content-free launch, visible-Running latency, terminal, cascade, and teardown-failure events after accepted current lifecycle transitions.
4. MUST never emit task/outcome text, prompt/transcript/result content, session/ACP ids, generations, titles, CWDs, paths, provider errors, or free-form error strings.
5. MUST make disabled telemetry a true no-op with no sink construction or access and deduplicate repeated terminal/cascade callbacks.
</requirements>

## Subtasks

- [ ] 8.1 Add typed allowlisted delegated lifecycle recorder events and private timing/deduplication state.
- [ ] 8.2 Emit events only from accepted controller lifecycle and cascade transitions.
- [ ] 8.3 Assert run-writer snapshots omit every delegation field while retaining ordinary child sessions.
- [ ] 8.4 Assert restore retains sessions but recreates no delegation graph, close state, or terminal ownership.
- [ ] 8.5 Add strict content-free and disabled-telemetry regression coverage.

## Implementation Details

Follow the TechSpec **Monitoring and Observability** and **Store and Controller Contract** sections. Keep persistence schemas and migration unchanged; use the existing recorder allowlist/local sink conventions and the ordinary `replaceSessions()` reset contract.

### Relevant Files

- `src/telemetry/recorder.ts` — owns typed allowlist, disabled recorder, local JSONL sink, timing, and deduplication.
- `src/telemetry/recorder.test.ts` — owns exact-record, strict-key, duplicate, and disabled-recorder coverage.
- `src/app/controller.ts` — owns accepted delegated launch, terminal, cascade, and restore transitions.
- `test/telemetry.integration.test.ts` — proves sensitive session/title/path fields never serialize.
- `src/persistence/runWriter.test.ts` — proves snapshots omit delegation while retaining ordinary conversations.
- `test/sessionRestore.integration.test.ts` — proves restore has no delegation ownership.

### Dependent Files

- `src/persistence/runWriter.ts` — existing snapshot projection intentionally omits `AppState.delegation`.
- `src/persistence/runRecord.ts` — strict V2 schema remains unchanged.
- `src/persistence/runStore.ts` — ordinary run storage remains unchanged.
- `src/store/appStore.ts` — resets delegation state during restore replacement.
- `src/core/orchestration.ts` — supplies empty/ordered child selectors for restore assertions.

### Related ADRs

- [ADR-001: Use a flat, host-owned delegation registry for V1](adrs/adr-001.md) — requires controlled cleanup.
- [ADR-003: Keep delegation state protocol-free and ephemeral in AppState](adrs/adr-003.md) — forbids persistence of delegation ownership.

## Deliverables

- Content-free, opt-in delegated lifecycle telemetry with strict allowlisted fields.
- Snapshot and restore proof that delegation ownership is never persisted or reconstructed.
- Telemetry/persistence integration regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for telemetry and restore boundaries **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Sensitive sentinel task/outcome/session inputs produce ordered lifecycle records containing none of those values or an `agent` field.
  - [ ] Disabled telemetry writes nothing and never constructs or accesses a sink.
  - [ ] Repeated terminal and cascade callbacks create one record per accepted lifecycle outcome.
  - [ ] A run snapshot with running and terminal children contains ordinary session/workspace data but no delegation fields, task/outcome text, generations, or terminal snapshot.
- Integration tests:
  - [ ] Restoring that record retains ordinary sessions while parent child selectors are empty and no close/lifecycle ownership returns.
  - [ ] Controller launch-to-Running latency, terminal, and cascade events appear only after accepted generation-current transitions.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- No persisted record or telemetry line reveals delegation content or identity beyond the existing safe event vocabulary.
- Restart can never claim live parent-child delegation ownership in V1.
