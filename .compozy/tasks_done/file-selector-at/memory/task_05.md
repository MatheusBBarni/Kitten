# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implement only the pure `src/ui/fileCompletion.ts` seam and direct tests; React/controller/telemetry integration remains task_06 scope.

## Important Decisions

- Treat accepted-reference ranges as half-open `[start, end)` intervals: edits at `start` shift the range, edits at `end` remain after it, and edits strictly inside overlap.
- Key Escape suppression by the dismissed token's start offset; a missing/different token or explicit focus change clears it.
- Rank case-folded basename-prefix matches before full-path substrings, then use deterministic case-folded lexical path order while returning original path spelling.

## Learnings

- The pure helper suite reaches 100% function and line coverage with the required 16 parser, ranking, formatting, suppression, correction, and composition cases.
- The repository verification gate completed with typecheck plus 1,379 passing tests, 1 intentional skip, and 0 failures.

## Files / Surfaces

- `src/ui/fileCompletion.ts`
- `src/ui/fileCompletion.test.ts`

## Errors / Corrections

- The first composition fixture queried `my`, which correctly ranked `docs/my-notes.md` before `src/My File.ts` under basename-prefix plus lexical ordering. Changed the fixture query to `file` so it isolates quoted insertion.

## Ready for Next Run

- Task_06 can consume the exported token, ranking, visible-limit, formatting, suppression, and pending-reference update helpers; no React or controller surface changed here.
- No task_05 finding met the shared-memory promotion test, so shared workflow memory remains unchanged.
