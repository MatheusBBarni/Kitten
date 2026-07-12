# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

## Shared Learnings

- The always-visible `KEYMAP_HINT` has an effective 18-cell budget to keep both agents' longest status/configuration chips visible at 80 columns; use caret notation for Ctrl chords and verify `StatusStrip.test.tsx` when adding a chord.

## Open Risks

- The full Bun suite passes but currently emits unrelated React `act(...)` and EventTarget listener-count diagnostics in existing UI tests; these predate backend config-writer work and may recur at later verification gates.

## Handoffs
