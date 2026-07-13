# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add composer-only controller actions for prompt-history recording/navigation and opt-in content-free history telemetry, with focused/explicit-session routing and failure-safe recall.

## Important Decisions

- Keep history capture explicit through `recordPromptHistory`; `sendPrompt`, handoff block sends, fresh-context sends, and controller initial-task sends must not record composer history implicitly.
- Derive edited-resend inside the action layer from the reducer-owned active cursor and entry, then call fixed telemetry methods that receive only the session id.
- Return navigation data from the reducer-updated session slice; distinguish `null` no-op from `""` clear-after-newest.
- Reset the recorder's per-session eligibility counter when `watch` observes a replacement ACP session, matching prompt-history run lifecycle.

## Learnings

- Tasks 1 and 2 are present in commits `010e74d` and `352d1d3`; `PromptHistoryState`, reducer events, store routing, and `selectSessionPromptHistory` are available prerequisites.
- Existing controller tests use real actions/store/reducer with only the external agent connection stubbed; this is the canonical service-integration suite.
- The real telemetry recorder can satisfy `ActionTelemetry` structurally, so controller-to-recorder integration is covered without an intermediate fake.

## Files / Surfaces

- Touched: `src/app/actions.ts`, `src/app/controller.test.ts`, `src/telemetry/recorder.ts`, `src/telemetry/recorder.test.ts`, `test/fakeController.ts`, `test/fakeController.test.ts`.

## Errors / Corrections

- The worktree already contains unrelated modified Compozy tracking files and memory directories; preserve them and stage only task-03-owned files.
- Self-review removed an action-local recalled-text cache because it could survive a session reset; edited-resend comparison now reads the current reducer-owned cursor instead.

## Ready for Next Run

- Controller/fake/recorder contracts are ready for task 04's `PromptEditor` integration.
- Fresh gate: `rtk bun run typecheck && rtk bun test` -> 1333 pass, 0 fail, 1 opt-in probe skipped.
- Coverage: 97.20% functions and 98.38% lines overall; `recorder.ts` 100%/100%, `actions.ts` 90.48%/96.97%.
