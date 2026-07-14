# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Render the selected session's reducer-owned default-application outcome in the status strip while preserving confirmed provider/model/effort values and the one-row 64-column footer contract.

## Important Decisions

- Reuse the existing `ModelSelect` outcome copy so the picker and status strip describe the same terminal result.
- Subscribe only through the curried `selectSessionDefaultApplyResult(sessionId)` selector; no controller action or state mutation belongs in the strip.
- Use compact strip-specific labels while preserving the longer picker copy; this keeps the 64-column footer truthful and single-row without sacrificing `/help`.

## Learnings

- The existing single-line footer has enough room at 64 columns for compact terminal copy (`default applied`, `effort unavailable`, or `model unavailable`) while retaining confirmed provider/model/effort and `/help`.
- Direct strip tests inject model/effort selector values but still seed real `config_options` so display labels and default-result state come from the same store-backed confirmed surfaces.

## Files / Surfaces

- Touched: `src/ui/StatusStrip.tsx`, `src/ui/StatusStrip.test.tsx`, and `src/ui/CockpitApp.test.tsx`.

## Errors / Corrections

- The initial red tests used `renderStrip`'s deliberately hidden slot selectors, so confirmed values rendered as em dashes. Passing explicit selector fixtures corrected the test seam; the resulting baseline then failed only on the missing outcome labels.

## Ready for Next Run

- Implementation and self-review are complete. Focused strip tests (11), mounted resize regression, typecheck, full tests, full coverage, self-check, and build all passed after the final source changes.
- The local commit must remain scoped to the three UI source/test files because unrelated tracked and untracked work was already present.
