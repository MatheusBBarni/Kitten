# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Carry Task 01's core-normalized colored layout through strict config loading, atomic persistence, confirmation, boot seeding, and watcher reload without weakening fail-closed behavior.

## Important Decisions

- Keep `normalizeStatuslineLayout` as the sole color parser. The config schema may transform accepted names/hex to canonical colors; the writer must serialize that transformed result, not the pre-transform merge.
- Preserve concurrent hard-stop continuation edits already present in `src/config/configLoader.ts`, `src/config/configLoader.test.ts`, and unrelated update-command edits in `src/index.ts`.

## Learnings

- Before this task, assigned config/lifecycle suites had no color-bearing assertions.
- `persistUserConfig` validated a transformed schema result but discarded it and wrote the original serialized merge, allowing accepted noncanonical color spellings to reach disk through a forged/runtime patch.

## Files / Surfaces

- `src/config/configWriter.ts`: serialize the strict schema's transformed canonical result before the existing exact-byte validation and atomic rename.
- `src/config/configLoader.test.ts`: canonical named/lowercase-hex loading plus invalid color and unknown-key rejection.
- `src/config/configWriter.test.ts`: canonical disk round-trip, unrelated-setting preservation, malformed-file behavior, invalid-patch no-change behavior, and symlink safety with colored layouts.
- `test/index.integration.test.tsx`: colored confirmation ordering, cancellation, failed persistence, and external reload without write-back.
- `test/configPersistence.integration.test.ts`: canonical fresh-boot round-trip and real watcher behavior for invalid and valid external colored edits.

## Errors / Corrections

- The first typecheck exposed unsafe access to `StatuslineItem.color` in a watcher predicate; narrowed the union to an object item before reading `color`.

## Ready for Next Run

- Focused config suites: 164 pass, 0 fail.
- Focused lifecycle suites: 25 pass, 0 fail.
- Focused coverage command passed the repository's enforced 80% threshold: 189 pass, 0 fail.
- Full TechSpec gate passed after the last code change: typecheck; 3,069 pass, 5 credentialed/manual skips, 0 fail; `SELF-CHECK OK`; build completed.
- Self-review found no scope expansion. Concurrent hard-stop continuation and update-command work remains untouched and must stay out of this task's commit.
