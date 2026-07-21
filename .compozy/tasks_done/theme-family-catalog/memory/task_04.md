# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Replace the legacy five-option Settings theme list with catalog-derived grouped rows and a bounded keyboard-following scrollbox while preserving immediate apply and overlay ownership.

## Important Decisions

- Use one typed row projection for rendering, navigation, and row identity; family headings are modeled but never selectable.
- Reuse the existing OpenTUI `scrollChildIntoView` pattern and keep horizontal scrolling hidden.
- Keep provenance as a short Theme Catalog documentation affordance only; preset rows must not include source or license metadata.
- Render catalog `displayName` values inside family groups so an off-screen heading never makes the active preset ambiguous.
- Treat the old full-frame Settings snapshot as an implementation detail and replace its coverage with explicit row, marker, documentation, and scroll behavior assertions.

## Learnings

- Task 03 intentionally left the legacy five-option `PALETTES` projection in Settings, so task 04 must stop deriving options from that UI palette aggregate.
- The existing `SettingsView` already self-gates behind clarification and approval; the picker change should remain inside `SettingsDialog`.
- A definite dialog height plus `flexGrow`/`flexShrink` on the scrollbox is required; `maxHeight` would collapse to intrinsic content and prevent scrolling.
- Full catalog display names retain active-family context even after a family heading scrolls out of the bounded viewport.

## Files / Surfaces

- Touched: `src/ui/SettingsView.tsx`, `src/ui/SettingsView.test.tsx`, `src/ui/CockpitApp.test.tsx`, and the Settings precedence case in `test/clarificationLifecycle.integration.test.tsx`.
- Removed the obsolete five-option Settings snapshot; the grouped picker is verified through explicit product behavior instead of a full-frame implementation snapshot.

## Errors / Corrections

- The worktree contains substantial unrelated staged and unstaged changes. Preserve them and stage only task 04 implementation files for the automatic commit.
- The first constrained-viewport test reached the final store preference but did not repaint the off-screen row. `scrollChildIntoView` had run before OpenTUI's native layout resolved the new child positions; defer the call by one task, matching `SlashMenu`'s established pattern.
- The 12-row regression initially left only a one-row list after adding the provenance footer. OpenTUI's nearest-edge logic does not move an equal-height child into a one-row viewport; removing the decorative footer margin preserves a two-row bounded viewport without dropping any content.
- Clarification resumption exposed a ref/effect race: the new Settings scrollbox painted before the passive effect revealed the preserved off-screen preference. Schedule visibility from the scrollbox ref attachment, cancelling the prior timer on detach, so initial mount, remount, and preference changes target the current native instance.
- The first full typecheck caught test-only strictness mismatches: compare the mutable projected ID array to a spread copy of the readonly catalog IDs, and index the known non-empty options array with an explicit assertion instead of carrying `.at(-1)` uncertainty.
- The first full test run exposed a lifecycle harness assumption: mounting with Settings already open hid the prompt placeholder that `mountLifecycle` uses as its readiness signal. Mount the base cockpit first, then open Settings before capturing its identity; the same precedence, suspension, resumption, and state-identity assertions remain intact.

## Ready for Next Run

- Implementation and self-review are complete. Focused Settings coverage measured 100% functions and 98.18% lines; the repository's aggregate threshold makes a single-file coverage invocation exit nonzero even though the changed Settings surface exceeds the task's 80% target.
- Fresh final verification passed: `rtk bun run typecheck && rtk bun test` completed with 3,009 pass, 5 credentialed skips, and 0 failures; `rtk bun run selfcheck` completed with `SELF-CHECK OK`; targeted Settings and clarification lifecycle suites also passed.
- Task tracking may be marked completed. Keep task memory and `task_04.md` out of the automatic code commit, do not change `_tasks.md`, and preserve the unrelated dirty/staged worktree state.
