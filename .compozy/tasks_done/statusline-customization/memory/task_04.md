# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Wire controller-owned statusline acknowledgement, confirmation, boot seeding, and external reload lifecycle with persist-before-apply behavior and deterministic injected tests.

## Important Decisions

- Preserve the existing explicit-write boundary: preview/store modal transitions never subscribe to persistence; only acknowledgement and confirmation may write.
- Treat the large pre-existing dirty worktree as unrelated user state and stage only task_04-owned files if verification permits a commit.
- Serialize theme and statusline writes through the existing cockpit write chain, but expose statusline persistence as its own injectable seam so tests can observe exact patches without touching user config.
- Return finite saved/error outcomes from the controller action surface; apply store state only after the persistence promise resolves successfully.
- Apply watcher-originated resolved statusline preferences directly to the store. Store equality suppresses unchanged reloads, and the absence of a statusline persistence subscription prevents write-back loops.

## Learnings

- `createCockpitSession` is the ownership boundary that has both the loaded config and config-writer lifecycle; wrapping the base controller actions there keeps config I/O out of the UI.
- The loaded `UserConfig` already contains the normalized statusline preference needed to seed a new cockpit, so boot does not need a second parsing path.
- The existing watcher callback can update theme and statusline together without persisting either watcher-originated value.

## Files / Surfaces

- `src/app/actions.ts`: UI-safe acknowledgement and confirmation contracts plus fail-soft defaults.
- `src/index.ts`: boot seeding, persist-before-apply actions, watcher reload, disposal, and injectable statusline writer.
- `test/fakeController.ts`, `test/fakeController.test.ts`: deterministic action recording and no-ACP coverage.
- `test/index.integration.test.tsx`: lifecycle, ordering, preview, watcher, no-loop, and failure coverage.
- `test/configPersistence.integration.test.ts`: real writer round-trip and fresh-session seed coverage.

## Errors / Corrections

- Self-review found confirmation captured acknowledgement before entering the serialized write chain. Moved patch construction into the queued write turn and strengthened the lifecycle test for back-to-back calls.
- The initial round-trip fixture used an invalid welcome-banner value; corrected it to the schema-supported `always` before re-running focused verification.
- The first full verification inherited simultaneous `NO_COLOR` and `FORCE_COLOR` environment variables. Re-ran coverage and the complete gate with `NO_COLOR` unset to obtain warning-free evidence.
- The first round-trip fixture used an invalid `welcomeBanner: "minimal"`; corrected it to the schema-supported `"always"` before re-running focused verification.

## Ready for Next Run

- Implementation and self-review are complete. Warning-free verification passed: typecheck; 1,831 tests with 0 failures; coverage threshold; headless self-check; compiled build.
- Task tracking can be marked complete and the six implementation/test files can be committed narrowly; do not stage this memory file or other Compozy tracking files.
