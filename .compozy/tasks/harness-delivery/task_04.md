---
status: completed
title: "Persist Content-Free Delivery Checkpoints Across Restore"
type: refactor
complexity: high
---

# Task 04: Persist Content-Free Delivery Checkpoints Across Restore

## Overview

Persist the controller's content-free harness-delivery checkpoint in a strict V3 run record and restore it conservatively. The task preserves V1 and V2 readability, prevents payload retention, and ensures an unresolved delivery never becomes a silent replay after restart.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST introduce a strict V3 checkpoint containing only harness version, non-negative generation, fixed state, and optional fixed failure category; see TechSpec "Data Models".
2. MUST keep V1 and V2 records readable and MUST NOT invent a checkpoint while normalizing them.
3. MUST serialize only the content-free checkpoint projection supplied by task_03; serialized records MUST exclude harness text, user task text, ACP IDs, profile details, paths, environment values, raw errors, and digests.
4. MUST restore successful provider loads as `not_required`, regardless of newer harness version, and MUST never inject into that existing provider history.
5. MUST restore explicit unresolved or failed V3 checkpoints as recovery-required without replaying the harness or initial task; sibling restored sessions MUST remain unaffected.
6. MUST keep rendered recovery UI out of scope; task_05 consumes the fixed projection.
</requirements>

## Subtasks

- [ ] 4.1 Define and strictly validate the V3 checkpoint schema.
- [ ] 4.2 Normalize V1 and V2 records without synthesizing delivery state.
- [ ] 4.3 Write only fixed checkpoint primitives into persisted snapshots.
- [ ] 4.4 Route restored checkpoint facts back to the controller lifecycle helper.
- [ ] 4.5 Preserve successful load continuity and isolate failed recovery state.
- [ ] 4.6 Add migration, serialization, and restore regression coverage.

## Implementation Details

Follow TechSpec "Data Models", "Integration Points", and "Testing Approach". Task_03 provides a content-free per-session delivery projection; this task owns its durable V3 representation and conservative restore behavior. Do not add prompt, harness, profile recipe, or raw error storage to solve retry ambiguity.

### Relevant Files

- `src/persistence/runRecord.ts` — strict V3 schema, types, and V1/V2 normalization.
- `src/persistence/runStore.ts` — snapshot sanitization and persisted-record validation.
- `src/persistence/runWriter.ts` — V3 write mapping from the task_03 projection.
- `src/app/controller.ts` — load checkpoint facts into the task_01 lifecycle helper at restore.
- `src/persistence/runStore.test.ts` — schema, migration, sanitization, and content-boundary tests.
- `src/persistence/runWriter.test.ts` — V3 snapshot mapping and no-content assertions.
- `src/app/controller.test.ts` — live-load, V2 migration, unresolved-checkpoint, and sibling restore behavior.

### Dependent Files

- `src/store/appStore.ts` — task_03 supplies the content-free projection used by the writer; this task must not add rendered UI state.
- `src/index.ts` — consumes the persisted run union and must retain existing restore behavior without direct changes.
- `test/sessionRestore.integration.test.ts` — existing restore contract that should compile and remain valid.
- `src/ui/ConversationView.tsx` — task_05 renders recovery-required state after this task makes it durable.

### Related ADRs

- [ADR-003: Own delivery state by controller generation and persist only a content-free checkpoint](adrs/adr-003.md) — primary V3 and restart-safety decision.
- [ADR-001: Scope harness delivery by live ACP session generation](adrs/adr-001.md) — ambiguous delivery must fail closed with no replay.
- [ADR-004: Gate harness encoding through exact certified runtime profiles](adrs/adr-004.md) — diagnostics and stored facts remain content-free.

## Deliverables

- Strict V3 persisted delivery checkpoint with V1/V2 compatibility.
- Content-boundary sanitization and conservative restore routing.
- Migration and restore regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for restore and sibling-session isolation **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Valid V3 records round-trip every fixed state and reject unknown state/category, extra fields, arbitrary strings, and invalid generations.
  - [ ] V1 and V2 inputs normalize without checkpoints and retain normal continuation behavior.
  - [ ] V3 serialization omits synthetic harness text, first-task text, ACP IDs, profile data, paths, environment values, raw errors, and digests.
  - [ ] Store sanitization rejects nested injected transcript or prompt fields under the checkpoint.
  - [ ] A delivered checkpoint never creates a second harness-bearing first turn after restore.
- Integration tests:
  - [ ] An explicit `in_flight` or `failed` checkpoint restores as recovery-required without replay while a sibling successfully loaded conversation stays live.
  - [ ] A successfully loaded V3 continuation remains `not_required` even when a newer harness version exists.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- V1, V2, and V3 records restore deterministically without content leakage.
- No unresolved checkpoint can silently resend a harness or user task.
