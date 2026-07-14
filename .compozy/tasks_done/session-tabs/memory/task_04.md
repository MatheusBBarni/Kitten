# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Replace the configuration-seeded controller lifetime plan with a mutable registry that owns one isolated runtime per conversation and restores V2 records in persisted workspace order while constraining V1 restore to resolved configuration descriptors.

## Important Decisions

- Keep configuration immutable and use it only for provider recipes, startup seeds, and V1 descriptor matching.
- Commit store placeholders and bind event subscriptions before ACP new/load calls so replayed events are retained.
- Replace restored workspace membership atomically so persisted order, lifecycle, selection, and attention survive before each runtime begins replay.
- Retain provider-missing V2 conversations as non-retryable unavailable placeholders; retain ACP load failures as retryable unavailable runtimes with isolated recovery.

## Learnings

- Binding a restored ACP session through the normal store start path reset persisted attention; the binding seam now has an explicit restore-only preservation option.
- Registry-backed branch refresh must run after restore, unavailable-session recovery, and new-run creation, not only after initial startup.

## Files / Surfaces

- `src/app/controller.ts` — mutable runtime ownership, V1/V2 restoration, failure isolation, recovery, branch refresh, and disposal.
- `src/app/controller.test.ts` — dynamic identity, replay ordering, recovery, missing-provider, V1 constraint, and disposal coverage.
- `src/store/appStore.ts` and `src/store/appStore.test.ts` — atomic restore placeholders and attention-preserving ACP binding.
- `test/sessionPicker.integration.test.tsx` — picker-driven dynamic V2 restore with startup configuration drift.

## Errors / Corrections

- The initial red tests exposed fixed-plan branch refresh and missing dynamic sibling lookup; registry-order enumeration corrected both.
- The first implementation allowed ACP binding to overwrite restored attention; corrected at the store binding seam and locked with unit/controller tests.

## Ready for Next Run

- Task 04 verification is clean: typecheck; 1,153 pass, 0 fail, 1 intentional opt-in skip; 96.74% function and 98.05% line coverage; self-check OK; compiled build successful.
- Dynamic restored conversations now own isolated runtimes and recovery. Conversation close teardown remains task_05; broader creation/action flows remain task_06.
