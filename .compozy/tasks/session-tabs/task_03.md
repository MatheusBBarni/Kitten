---
status: pending
title: "Add V2 run persistence and V1 migration"
type: refactor
complexity: high
---

# Task 03: Add V2 run persistence and V1 migration

## Overview

Introduce a versioned saved-run contract that restores dynamic Session Tabs while keeping existing V1 records readable. New snapshots must preserve workspace-owned metadata exactly once, retain per-conversation ACP resume data, and allow an empty visible workspace.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST define and validate a discriminated V1/V2 run-record union while preserving legacy V1 field names and load behavior.
2. MUST make every new snapshot version 2 and store lifecycle, display name, order, selection, and acknowledgement only in persisted workspace metadata.
3. MUST serialize only execution/resume information for each V2 conversation and omit Closed conversations, raw errors, ephemeral notices, keyboard capability, and transcript turns.
4. MUST migrate V1 records using matching resolved configuration descriptors and `PersistedAgent.sessionId` as the ACP resume pointer without inventing dynamic metadata.
5. MUST permit null selection and null branch metadata for a valid empty workspace while preserving redaction, atomic-write, and fail-soft behavior.
</requirements>

## Subtasks
- [ ] 3.1 Define versioned record and workspace persistence shapes.
- [ ] 3.2 Validate V2 membership, lifecycle, ordering, selection, and descriptor invariants.
- [ ] 3.3 Preserve V1 readability through a constrained migration path.
- [ ] 3.4 Snapshot version-2 execution and workspace metadata without duplication.
- [ ] 3.5 Verify saved-run files, redaction, and empty-workspace behavior.

## Implementation Details

Apply the TechSpec’s **Persistence and Restore** and **Version-2 Validation Invariants** sections. Keep saved records content-safe and configuration-immutable; controller restore behavior belongs to the controller task.

### Relevant Files
- `src/persistence/runRecord.ts` — V1 contract and new V2 discriminated record definitions.
- `src/persistence/runStore.ts` — record validation, sanitization, summaries, safe file I/O, and loading.
- `src/persistence/runStore.test.ts` — decoder, corruption, safety, and migration fixtures.
- `src/persistence/runWriter.ts` — store snapshot and flush behavior.
- `src/persistence/runWriter.test.ts` — debounce, dispose, snapshot, and disabled-mode coverage.
- `test/runStore.integration.test.ts` — actual saved-run file round-trip assertions.

### Dependent Files
- `src/app/controller.ts` — consumes V1 migration output and record-driven V2 restore data.
- `src/ui/SessionPicker.tsx` — presents saved-run summaries with nullable V2 selection.
- `src/ui/SessionPicker.test.tsx` — must retain V1 and V2 picker expectations.
- `test/sessionRestore.integration.test.ts` — validates controller restore semantics.
- `test/sessionPicker.integration.test.tsx` — validates picker-to-restore wiring.
- `src/config/configLoader.ts` — supplies immutable descriptors for V1 migration only.

### Related ADRs
- [ADR-002: Prioritize a Restorable, Fast-Switching Conversation Tab Workspace](adrs/adr-002.md) — requires full visible/background workspace restoration.
- [ADR-004: Separate Workspace Metadata from Session State and Persist a Versioned Workspace](adrs/adr-004.md) — defines V2 ownership and V1 migration constraints.

## Deliverables
- V1/V2 persisted record union, validators, and V2 writer snapshot.
- Constrained V1 migration support plus safe V2 summary data for saved-run consumers.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests covering actual V1/V2 save/load behavior **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] New snapshots are version 2 and preserve dynamic visible/background descriptors, names, order, selection, attention, and ACP pointers.
  - [ ] Empty visible workspace persists null selection and null branch metadata.
  - [ ] Closed conversations, raw errors, ephemeral notices, capability state, and transcript turns are absent from V2 output.
  - [ ] Invalid order membership, duplicate IDs, invalid lifecycle, and invalid selection are rejected or fail-soft as specified.
  - [ ] V1 records retain only matching configuration-backed entries and use their saved ACP pointers without inventing user metadata.
- Integration tests:
  - [ ] Atomic save/load round-trip preserves valid V2 state and leaves unrelated run files available after malformed input.
  - [ ] Legacy V1 files remain listable and loadable during the migration window.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing.
- Test coverage >=80%.
- Version 2 is the only write format and V1 remains safely readable.
- Persisted workspace metadata has one canonical source with no configuration mutation.
