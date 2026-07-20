# Task Memory: task_09.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add opt-in, content-free explorer telemetry with closed event/outcome types, recorder facade methods, action ordering, and privacy-negative unit/integration proof.

## Important Decisions

- Keep task 09 changes limited to telemetry-owned surfaces until the prerequisite explorer controller/action seam exists; do not implement task 05 implicitly inside this task.
- Serialize only `agentRef` ordinals for explorer events. Use `refreshed | source-failed` for refresh settlement, `unsupported | source-failed | default-opened | custom-opened | final-failure` for final open settlement, and hard-code `fallback` on the separate fallback event so actions can preserve fallback-before-final ordering without accepting details.

## Learnings

- The current branch has no `src/app/workspaceExplorer.ts` and no explorer methods in `ControllerActions`, so action-boundary emission and cross-boundary integration proof cannot yet be wired honestly.
- Task 05 is marked `completed` while all of its checklist items remain open; its status is not implementation evidence.
- Runtime guards are required in addition to TypeScript unions because casted JavaScript values could otherwise serialize unbounded outcome text.

## Files / Surfaces

- Touched: `src/telemetry/recorder.ts`, `src/telemetry/recorder.test.ts`, and the telemetry-only facade types in `src/app/actions.ts`.
- Blocked integration surfaces: `src/app/actions.ts`, `src/app/actions.test.ts`, `test/telemetry.integration.test.ts`.

## Errors / Corrections

- Corrected the execution plan after repository reconciliation: complete and verify the independent recorder portion, but leave task status pending and do not commit unless the missing controller boundary is restored and the whole task passes.
- `bun test --coverage src/telemetry/recorder.test.ts` ran 81 passing tests and measured `src/telemetry/recorder.ts` at 98.92% functions / 99.14% lines, but exited 1 because the single-file run covers transitive modules and the aggregate was 38.84% functions / 39.92% lines. Do not report the repository coverage gate as passing from this narrow run.
- Fresh full gate `bun run typecheck && bun test` passed typecheck but failed the suite with 2,618 pass / 4 skip / 1 fail. The failure is the unrelated OpenTUI timing test `Markdown > registers capabilities on a direct multi-block mount before code rendering`, which timed out after 20 frame passes; task 09 remains pending regardless because action integration is absent.

## Ready for Next Run

- Recorder event families, closed facade methods, disabled no-sink behavior, runtime validation, and privacy-negative unit tests are implemented locally.
- Resume only after task 05 restores the explorer action/source boundary; then wire visibility, refresh, fallback-before-final settlement, add `actions.test.ts` plus `test/telemetry.integration.test.ts`, and run the full completion gate.
- Task tracking now marks only 9.1, 9.2, and 9.4 complete. Subtasks 9.3 and 9.5 remain open; no commit was created.
