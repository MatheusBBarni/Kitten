---
status: pending
title: Persist V4 bindings and reconcile restored worktrees
type: backend
complexity: high
---

# Task 06: Persist V4 bindings and reconcile restored worktrees

## Overview

Add strict V4 persisted binding identity and restore-time reconciliation so retained child work remains reviewable after restart. The migration must keep V1–V3 records readable, leave delegation empty, and never substitute a parent cwd for unavailable work.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add a strict optional V4 nested binding with only id, root, path, branch, base branch/SHA, and owner session id.
2. MUST preserve V1–V3 parse/load/restore behavior and make zero reconciliation calls for records without V4 bindings.
3. MUST reject unknown nested fields, owner mismatches, lifecycle content, availability, and refusal reasons before persistence.
4. MUST restore V4 bindings as `unverified`, reconcile after session replacement, and publish only bounded results.
5. MUST preserve the restored child cwd, healthy sibling restore, and empty delegation even when reconciliation is unavailable.
</requirements>

## Subtasks
- [ ] Define V4 schemas, exports, and backward-compatible union membership.
- [ ] Add strict run-store sanitization and binding ownership validation.
- [ ] Serialize only binding identity in writer snapshots.
- [ ] Restore bindings as unverified and reconcile after session replacement.
- [ ] Add schema, writer, controller, and session-restore coverage.

## Implementation Details

Follow the TechSpec Data Models and launch/restore data flow. Keep Git lifecycle implementation in the service and UI rendering outside this task.

### Relevant Files
- `src/persistence/runRecord.ts` — strict persisted schemas and record version union.
- `src/persistence/runWriter.ts` — session snapshot serialization.
- `src/persistence/runStore.ts` — run sanitization and version handling.
- `src/app/controller.ts` — restore descriptors and post-replacement reconciliation.
- `src/persistence/runStore.test.ts` — strict persistence and sanitization tests.
- `src/persistence/runWriter.test.ts` — snapshot privacy tests.
- `test/sessionRestore.integration.test.ts` — end-to-end restore behavior.

### Dependent Files
- `src/store/selectors.ts` — later presents restored available/unavailable state.
- `src/ui/SessionsOverlay.tsx` — later renders retained review state.
- `src/telemetry/recorder.ts` — later records accepted reconciliation categories.

### Related ADRs
- [ADR-003: Persist managed bindings in versioned session records and reconcile on restore](adrs/adr-003.md) — primary data-model decision.
- [ADR-001: Create managed worktrees only for spawned child sessions](adrs/adr-001.md) — preserves non-persistent delegation ownership.

## Deliverables
- V4 schema, writer, store, and restore reconciliation support.
- Unit tests with >=80% coverage **(REQUIRED)**.
- Session-restore integration tests for available and unavailable bindings **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] V4 round-trip keeps exactly the permitted binding identity fields.
  - [ ] V1–V3 records load unchanged and do not reconcile.
  - [ ] Extra, wrong-owner, availability, reason, task, transcript, and raw-error binding fields fail strict validation.
  - [ ] Writer excludes delegation, task/outcome, runtime, transcript, availability, and refusal reason.
- Integration tests:
  - [ ] Available and missing V4 bindings restore as ordinary sessions with empty delegation.
  - [ ] Unavailable reconciliation preserves child cwd and does not disrupt healthy sibling restore.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Old run records remain readable.
- Restore never fabricates live delegation or a parent-cwd fallback.
