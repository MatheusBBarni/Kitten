# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

- The initial catalog has no historical alias IDs: issue #31, the packet, and repository history name no retired or renamed preset. Keep the explicit alias map empty rather than inventing accepted config input; future compatibility work must add only a real documented migration.

## Shared Learnings

## Open Risks

## Handoffs

- Task 03 introduced exhaustive `PRESET_PALETTES` and canonical `resolvePalette` behavior for all 18 presets. The legacy `PALETTES` aggregate intentionally retains the established five Settings options because exposing all 18 before task 04's catalog-driven selector clips the non-scrollable footer; task 04 should replace that projection as a unit.
