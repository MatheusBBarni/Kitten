# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Extend the pure statusline contract with strict item-local foreground colors while preserving every legacy text and width invariant.

## Important Decisions

- Keep canonicalization and item-shape rejection exclusively in `src/core/statusline.ts`; UI presentation, config I/O, and proposal grammar remain later-task concerns.
- Use the complete opaque named-color table from CSS Color 4, case-insensitively, while excluding special values such as `transparent` and `currentcolor`.

## Learnings

- Extending `StatuslineItem` exposed `sameStatuslinePreference` as a dependent semantic-equality surface; it must compare canonical colors and distinguish structured simple items from ellipsis items.

## Files / Surfaces

- `src/core/statusline.ts`
- `src/core/statusline.test.ts`
- `src/store/appStore.ts`
- `src/store/appStore.test.ts`

## Errors / Corrections

- Initial typecheck found object-item assumptions in core ellipsis rendering and store preference equality; both were narrowed explicitly and covered by focused tests.

## Verification

- Focused statusline coverage: 66 passed, 0 failed; `src/core/statusline.ts` reached 100% functions and 98.89% lines.
- Focused core/store suites: 181 passed, 0 failed.
- Full repository gate passed: typecheck; 3,065 tests passed, 5 credential-gated tests skipped, 0 failed; self-check; compiled build.

## Ready for Next Run

- Task 01 is complete in local commit `7e12441`. Later tasks can consume canonical `StatuslineItem` colors and `StatuslineSegment.color`; semantic store equality already accounts for structured items and canonical colors.
