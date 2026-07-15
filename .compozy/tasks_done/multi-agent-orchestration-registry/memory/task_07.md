# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add a store-derived active-child close summary and a captured-parent two-choice close warning in `TabDialog`.
- Cover live status/count updates, parent-only actions, nonfocused `/sessions` entry, modal input blocking, and approval priority.

## Important Decisions

- Keep cascade semantics entirely behind the existing parent `closeConversation(parentId, "cancel")` boundary; the UI will never issue child cancellation actions.
- Treat only `starting`, `running`, and `needs_input` children as affected. A terminal-only group uses the existing ordinary close policy.
- Preserve the captured `TabDialogOverlay.sessionId` as the selector/action key, independent of workspace focus.
- Limit the warning to the default parent cancellation and `Keep working`; when the active-child summary becomes empty, return to the ordinary close policy.

## Learnings

- Live delegation publications update the captured parent's warning copy and keep the selected choice clamped without changing workspace focus or the action target.
- Focused verification passes: 116 tests, 0 failures, and 387 assertions across the selector, dialog, and sessions-overlay suites; `bun run typecheck` also passes.
- Focused coverage passes with relevant production line coverage above the required threshold: `selectors.ts` 97.80%, `TabDialog.tsx` 97.73%, and `SessionsOverlay.tsx` 98.79%.
- Fresh `bun run selfcheck` reports `SELF-CHECK OK`; the compiled build succeeds and writes `dist/kitten-darwin-arm64` with SHA-256 `509b832be9644c5d4ac0bd6ded78913552263a7e2cdc8086dd6948330f73a67e`.
- The required full `bun test` gate remains blocked by two pre-existing `test/releaseWorkflow.test.ts` assertions caused by `.github/workflows/release.yml` using `secrets.NPM_TOKEN`, followed by the known same-process OpenTUI/TreeSitter failure cascade: 1999 pass, 4 skip, 217 fail. Typecheck completed successfully before that failure.

## Files / Surfaces

- `src/store/selectors.ts`: compact cached active-child close summary with explicit delegated status labels.
- `src/store/selectors.test.ts`: active/terminal filtering, labels, counts, and stable identity coverage.
- `src/ui/TabDialog.tsx`: captured-parent two-choice warning, live count/status copy, and ordinary-policy fallback.
- `src/ui/TabDialog.test.tsx`: exact warning content, parent-only actions, keep-working/Escape, live updates, modal input blocking, shell-byte blocking, and approval priority.
- `src/ui/SessionsOverlay.test.tsx`: background/nonfocused captured-target integration coverage through `/sessions`.

## Errors / Corrections

- Pre-change focused evidence confirms a working parent currently renders all three ordinary close choices; no delegated-parent summary selector exists yet.

## Ready for Next Run

- Re-run the full repository test gate after the unrelated release-workflow/TreeSitter failure chain is repaired. Only then complete task tracking and create the automatic local commit; implementation and focused verification are already in place.
