# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the stateless repository-file selector presentation leaf and central `@` editor-help entry, with focused OpenTUI and keymap coverage.

## Important Decisions

- Keep `FileSelector` presentation-only: it receives prevalidated relative paths, status, and highlight from its owner and imports no controller, filesystem, telemetry, or store surface.
- Cap rendering inside the leaf at eight rows as a defensive presentation guarantee; keep navigation entirely in the existing `MENU_KEYMAP`/`matchMenuCommand` contract.

## Learnings

- Baseline searches found neither a `FileSelector` symbol nor an `@` entry in `EDITOR_KEYMAP`; the relevant UI files had no pre-existing diff.
- A partial coverage run imports the real provider/palette dependency tree and therefore cannot satisfy the repository-wide threshold by itself; the full coverage run is the authoritative gate.

## Files / Surfaces

- `src/ui/FileSelector.tsx`: new stateless selector statuses, full-path rows, highlight, and eight-row cap.
- `src/ui/FileSelector.test.tsx`: mounted OpenTUI status, path, highlight, cap, and prompt-order coverage.
- `src/ui/keymap.ts` and `src/ui/keymap.test.ts`: central `@` help entry with shared menu mapping unchanged.
- `src/ui/CockpitApp.test.tsx`: explicit mounted help-surface assertion for file discovery.

## Errors / Corrections

- The tests-first run failed as expected on the missing `FileSelector` module and absent `@` help entry; implementation made the focused suite green.
- The targeted coverage command exited nonzero only because it measured an incomplete imported graph; it still reported 100% functions/lines for both changed production files. The full `bun run test:coverage` gate passed at 97.19% functions and 98.30% lines overall.

## Ready for Next Run

- Task 04 implementation and tracking are complete. Fresh evidence: typecheck plus 1,363 passing tests (one external probe skipped), full coverage above threshold, and `SELF-CHECK OK`.
- Task 06 can mount `FileSelector` above `PromptEditor` and pass its local status, filtered paths, and selected index while reusing `MENU_KEYMAP`.
