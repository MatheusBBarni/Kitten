# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add a strict content-free V3 harness-delivery checkpoint, preserve V1/V2 readability, and restore explicit ambiguity as a blocked delivery without replay or sibling impact.

## Important Decisions

- V3 stores a top-level per-session `harnessDeliveries` record. Each checkpoint is a strict state-discriminated object; `failed` requires one fixed failure category and every other state forbids it.
- Restore rebinds persisted facts to the new controller generation. `pending` and `in_flight` become `failed/dispatch_indeterminate`; an explicit `failed` category is preserved; successful loads and delivered checkpoints become `not_required`.
- A fresh fallback receives a new opportunity only when the checkpoint is absent or settled; explicit unresolved/failed facts remain recovery-required.

## Learnings

- `FileRunStore.save` intentionally sanitizes broad legacy record extras before schema parsing, so checkpoint payloads require an explicit strict parse before projection to reject nested prompt/transcript injection rather than silently dropping it.
- The focused coverage run reports line coverage above 80% on every task-owned implementation surface (`runRecord` 88.24%, `runStore`/`runWriter`/`harnessDelivery` 100%, controller 95%).

## Files / Surfaces

- `src/persistence/runRecord.ts`, `src/persistence/runStore.ts`, `src/persistence/runWriter.ts`
- `src/app/harnessDelivery.ts`, `src/app/controller.ts`
- `src/persistence/runStore.test.ts`, `src/persistence/runWriter.test.ts`, `src/app/harnessDelivery.test.ts`, `src/app/controller.test.ts`
- `test/sessionRestore.integration.test.ts`, `test/sessionTabs.integration.test.tsx`

## Errors / Corrections

- The first focused run failed because the writer test double still rejected non-V2 records; it now records and asserts V3 snapshots.
- The existing unavailable-pane integration needed an explicit controller-side certified test capability after task_03 made fresh prompts fail closed.
- Repository-wide `bun test` remains non-clean: two known `test/releaseWorkflow.test.ts` secret-token contract failures plus two `test/clarificationLifecycle.integration.test.tsx` fresh-prompt fixtures that lack matching task_03 harness certification.

## Ready for Next Run

- Focused unit, restore integration, typecheck, and task-owned coverage pass. Do not mark complete or commit until the full repository gate is clean after the unrelated/prerequisite failures above are resolved.
