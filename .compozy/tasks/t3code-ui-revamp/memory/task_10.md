# Task Memory: task_10.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Centralize workbench selection, board return context, revision fallback, focus
  restoration, and namespaced drafts in renderer-owned view state without
  copying host projections.

## Important Decisions

- Preserve the existing uncommitted prerequisite-task stack and restrict Task
  10 edits to renderer state, board/shell/inspector integration, focused tests,
  and task tracking.
- Treat `WorkflowBoardContainer`'s component-local `selectedCardId` and
  `CardInspector`'s card-only draft store as the pre-change seams to replace,
  not mirror.
- Use identity-only workbench targets and origins. Board/card/attempt validity
  is reconciled from refreshed query results; no workflow projection is copied
  into Zustand.
- Keep the first valid board projection's identity in the view store so opening
  a card does not switch from the implicit board query key to an explicit key
  mid-interaction.

## Learnings

- The prerequisite renderer/host changes are already present but uncommitted;
  shared workflow memory records the inherited per-file coverage gate as the
  reason earlier tasks remain pending.
- The current view store owns route, active board, board mode, project setup,
  and collapsed projects, but no workbench or draft state.
- HeroUI v3 Accordion uses controlled `expandedKeys` and
  `onExpandedChange`; the selected attempt can therefore remain renderer-owned.
- Namespaced draft persistence reads the prior card-only composer key once, so
  existing local drafts survive the move to project/board/card/source identity.
- Focused store coverage is 100% functions and 100% lines in the repository
  coverage report; the required board restoration and inspector interaction
  cases are green.

## Files / Surfaces

- `packages/desktop/src/renderer/state/desktopViewStore.ts`
- `packages/desktop/src/renderer/features/board/WorkflowBoardContainer.tsx`
- `packages/desktop/src/renderer/features/inspector/CardInspector.tsx`
- `packages/desktop/src/renderer/main.tsx`
- `packages/desktop/src/renderer/features/inspector/AttemptTimeline.tsx`
- `packages/desktop/src/renderer/features/board/WorkflowBoard.tsx`
- `packages/desktop/src/renderer/state/desktopViewStore.test.ts`
- `packages/desktop/src/renderer/features/board/WorkflowBoardContainer.test.tsx`
- `packages/desktop/src/renderer/features/inspector/CardInspector.test.tsx`

## Errors / Corrections

- Repository commands must be run through `rtk`; use desktop scripts from
  `packages/desktop` as `rtk bun run <script>`.
- The first board integration test initially entered a render loop because the
  active board identity was still implicit. Wiring `setInitialBoard` removed
  the query-key transition and preserved the mounted board surface.
- `rtk bun run verify` remains red after implementation: typecheck and
  acceptance pass, but coverage reports 293 pass / 1 fail / 1 error because an
  unrelated `reviewEvidence.test.ts` Git-fixture hook times out, followed by a
  fixture `git config` failure. The repository also retains inherited per-file
  coverage deficits even though aggregate coverage is 92.25% functions /
  93.15% lines and `desktopViewStore.ts` is 100% / 100%.

## Ready for Next Run

- Implementation, focused tests, typecheck, acceptance, build, task packet
  validation, and diff hygiene are green.
- Task tracking remains pending and no automatic commit was created because the
  required repository `verify` gate exits 1.
