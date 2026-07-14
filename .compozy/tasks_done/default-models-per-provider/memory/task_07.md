# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Apply provider defaults only after a different explicit `/model` tab selection, then render session-scoped terminal feedback from confirmed state.
- Required evidence includes modal ordering, non-trigger paths, preserved manual confirmation, applied/partial/unavailable rendering, no tab bleed, >=80% coverage, and the full repository gate.

## Important Decisions

- Keep the existing synchronous close -> `model_select` conversation selection -> reopen sequence, and invoke the single controller action only after reopen.
- Render no feedback for `none`; render compact labels for `applied`, partial effort unavailability, and unavailable model/session results without deriving requested values.
- The fake controller accepts per-session terminal results, records action targets, and captures selected/overlay state at invocation so rendered tests can prove the destination is already selected and reopened.

## Learnings

- Pre-change `rtk bun test src/ui/ModelSelect.test.tsx` passes 19 tests, but `ModelSelect` has no `applyProviderDefaults` call and the fake action always emits unrecorded `none`; task behavior is therefore absent rather than represented by a failing legacy test.
- The narrow selector already exists as `selectSessionDefaultApplyResult(sessionId)` and returns the reducer-owned result unchanged.
- Focused rendered coverage reaches 100% functions and 99.67% lines for `ModelSelect.tsx`; the full suite reaches 97.33% functions and 98.16% lines.
- The repository test gate is warning-clean when the inherited `FORCE_COLOR` variable is removed; otherwise Bun reports that `NO_COLOR` is ignored even though tests pass.

## Files / Surfaces

- Planned task-owned surfaces: `src/ui/ModelSelect.tsx`, `src/ui/ModelSelect.test.tsx`, and `test/fakeController.ts`.
- Dependent prior-task changes already present in the dirty worktree: `src/core/types.ts` and unrelated fixture/config changes; preserve them without taking ownership.
- Implemented task-owned surfaces: `src/ui/ModelSelect.tsx`, `src/ui/ModelSelect.test.tsx`, and `test/fakeController.ts`.
- The required selector was absent from `HEAD`, so the self-contained commit also includes the directly relevant `src/store/selectors.ts` selector and its `src/store/selectors.test.ts` coverage.

## Errors / Corrections

- The first non-trigger regression incorrectly expected passive `switchFocus("codex")` to leave the selected conversation on Claude; corrected it to assert Codex selection while still proving no default action ran.
- Initial scope notes treated the selector worktree diff as an external dependency; the pre-commit `HEAD` audit showed it was not committed, so its narrow implementation and tests must travel with task 07.

## Ready for Next Run

- Complete. Explicit different-tab selection now closes, selects with `model_select`, reopens, and invokes one default action; picker feedback remains session-scoped and confirmed-row-only.
- Fresh verification: focused 23/23; full 1768 pass, 3 credential/environment skips, 0 fail; coverage 97.33% functions / 98.16% lines; self-check OK; host build succeeded.
- Scoped implementation commit: `0630993` (`feat(model-select): apply provider defaults on tab selection`); task tracking and workflow memory remain outside the commit as required.
