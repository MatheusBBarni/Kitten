# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the target agent's honest context headroom to the handoff preview directly after the redaction notice, with known/unknown and 24-row frame coverage.

## Important Decisions

- Reuse the same neutral five-cell `formatHeadroom` display as the ambient gauge: muted label/track and normal text for the value/fill.
- Subscribe with a selector memoized only on `targetSessionId`; do not read the target session object broadly.

## Learnings

- The preview's existing `maxHeight` and shrinkable summary preserve the send hint after the extra fixed row at 80x24.
- A focused `bun test src/ui/HandoffPreview.test.tsx --coverage` loads much of the cockpit graph and exits on the aggregate repository threshold even though `HandoffPreview.tsx` itself reports 100% function and 97.90% line coverage; the full-suite coverage command is the meaningful aggregate gate.

## Files / Surfaces

- `src/ui/HandoffPreview.tsx`
- `src/ui/HandoffPreview.test.tsx`

## Errors / Corrections

- No implementation error. The scoped coverage command's nonzero exit is a threshold-scope artifact; verify aggregate coverage with the full suite before completion.

## Ready for Next Run

- Implementation and tracking are complete. Evidence: focused preview suite 36/36; full suite 1,280 pass / 1 skip / 0 fail; full coverage 97.04% functions and 98.26% lines; `HandoffPreview.tsx` 100% functions and 97.90% lines; `SELF-CHECK OK`.
- Scoped implementation commit created: `c761353` (`feat: show target headroom in handoff preview`). Task and workflow-memory tracking files remain outside the commit per the caller's instruction.
