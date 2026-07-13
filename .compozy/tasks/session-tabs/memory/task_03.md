# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Replace V1-only writes with a validated V2 workspace record while retaining safe V1 reads and a configuration-backed migration helper.

## Important Decisions

- Keep V2 execution/resume fields in top-level `conversations`; persist lifecycle, display name, order, selection, and attention acknowledgement only under `workspace`.
- Keep controller registry restore out of task 03; expose typed V1/V2 records and migration/accessor seams for dependent consumers.
- Treat V2 structural corruption as a fail-soft rejected record; runtime/provider unavailability remains a controller restore concern.

## Learnings

- The current writer emits `version: 1` and throws when `workspace.selectedVisibleId` is null.
- Task 01 and task 02 tracking edits pre-existed this run and must not be included in task 03's commit.
- V2 validation requires exact membership across execution descriptors, workspace metadata, and unique order; null selection is valid only when no Visible conversation exists and branch metadata is null.
- Zod 4 strict external contracts use `z.strictObject`; V1 decoding intentionally retains tolerant unknown-key stripping for migration compatibility.

## Files / Surfaces

- Persistence: `src/persistence/runRecord.ts`, `runStore.ts`, `runWriter.ts`, and their unit tests.
- Consumers: `src/app/controller.ts`, `src/ui/SessionPicker.tsx`, affected fixture types, and `test/runStore.integration.test.ts`.

## Errors / Corrections

- Corrected the initial null-selection validator to reject records that still contain a Visible conversation.

## Ready for Next Run

- Task 03 is complete. Fresh gate: typecheck passed; 1,146 tests passed, 0 failed, 1 opt-in reload probe skipped; 98.04% line coverage; `SELF-CHECK OK`.
- Task 04 can replace the temporary configured-ID V2 resume projection with full record-driven dynamic registry restoration.
