# Task Memory: task_15.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add one renderer-owned critical-path command registry, restorative Settings
  navigation, deterministic focus/fallback behavior, content-free live
  announcements, and keyboard/accessibility coverage without duplicating host
  workflow authority.

## Important Decisions

- `next-actionable` will consume the host-projected supervision order; only
  adjacent-card navigation may use deterministic renderer-projected order.
- Task completion and the automatic commit remain gated on both fresh automated
  verification and the ADR-006 packaged native Settings/focus evidence.
- The command registry is pure and receives mounted renderer targets. The shell
  installs the one global key router; lifecycle availability still comes from
  mounted host projections rather than a renderer-owned status model.
- Settings snapshots view identities and focus state explicitly while leaving
  the active workflow projections untouched. Review file and active draft
  namespace moved into the existing ephemeral view store so they survive route
  unmount/remount.
- Review restoration carries the attempt identity and remaps the selected
  logical file by old/new path when regenerated evidence changes both evidence
  and file IDs.

## Learnings

- The required prerequisite implementation is present as a broad, uncommitted
  dirty worktree. Task 15 must preserve that state and stage only attributable
  task surfaces if every completion gate passes.
- No `renderer/commands/desktopCommands.ts` registry exists at the pre-change
  baseline.
- HeroUI's workbench drawer makes the outer route chrome non-interactive while
  open, so Settings is also exposed inside the workbench and through the global
  command.

## Files / Surfaces

- Expected task surfaces: renderer command registry/tests, desktop view
  store/tests, renderer shell/tests, and inspector focus registration.
- Touched: `renderer/commands/desktopCommands.ts` and test,
  `renderer/state/desktopViewStore.ts` and test, `renderer/main.tsx` and test,
  board/sidebar command targets, inspector/review focus registration, and
  Settings heading focus.

## Errors / Corrections

- The first acceptance run treated a static `main.test.tsx` import as a
  renderer-to-host boundary violation because the boundary test matches
  `/main.ts`; the integration test now dynamically imports the renderer entry,
  and the acceptance suite passes.
- The first full coverage run caught a real stale-evidence regression: a host
  refresh replaced the selected evidence identity and closed review. Review
  selection now falls back by its stored attempt identity and preserves the
  selected logical file across regenerated IDs. The existing stale-rejection
  integration passes.
- Self-review found that attempt reconciliation could leave a review tied to a
  removed attempt. It now clears that review, chooses the host-projected latest
  attempt, and announces the content-free fallback.
- Fresh focused tests, `typecheck`, `test:acceptance`, the enforced 80%
  `test:coverage` gate, final `verify`, the packaged Electrobun build, and
  `compozy tasks validate --name t3code-ui-revamp` all pass.
- Packaged native evidence is still unavailable. The built
  `dev.kitten.orchestrator` Bun/WebKit process reached its native event loop,
  but Computer Use returned `cgWindowNotFound` for the packaged app and direct
  read-only screen capture reported no display. The exact test processes were
  stopped after diagnosis. Per ADR-006, do not mark complete or commit from
  this state.

## Ready for Next Run

- Rebuild from the unchanged verified source in a visible macOS session, then
  capture the packaged Settings entry/return, restored composer/review focus,
  shortcut help, and responsive workbench path. Only after that evidence passes
  should task/master tracking be completed and the automatic local commit be
  created.
