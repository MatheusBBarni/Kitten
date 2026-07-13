# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Expose the full conversation lifecycle/navigation boundary through `ControllerActions`, make selected-only consumers inert for a valid null selection, and preserve background attention plus preview-first handoff safety.

## Important Decisions

- Keep runtime creation and teardown in `SessionController`; action methods delegate effects and own UI-safe store transitions.
- Treat the existing task_01-task_05 tracking and workflow-memory changes as pre-existing user/workflow state; do not rewrite or stage them as task_06 implementation.
- Keep `jumpToNextNeedy` as a compatibility alias while exposing the contract name `jumpToNextAttention`.
- Represent the empty-workspace creation failure as a transient `workspaceNotice`; persistence continues to omit notices.

## Learnings

- `selectSessionList` already covers Visible and Background entries while excluding Closed/removed entries, so notifier production behavior needed regression coverage rather than a policy rewrite.
- Dynamic creation must commit the descriptor before connecting so a failed provider affects only the new conversation and retains a stable unavailable tab.

## Files / Surfaces

- Touched: `src/app/actions.ts`, `src/app/controller.ts`, `src/app/handoff.ts`, `src/core/types.ts`, `src/store/appStore.ts`, `src/store/selectors.ts`, action/handoff/notifier tests, and controller fakes/integration tests.
- `src/notify/notifier.ts` required no production change; its existing selection-independent latch was validated directly.

## Errors / Corrections

- The baseline contract test failed because `createConversation` was absent from `ControllerActions`; the expanded boundary now passes that test.
- The task packet does not contain optional `_tests.md` or `_user_stories.md` catalogs; task-local and TechSpec test obligations were used.

## Ready for Next Run

- Implementation and self-review complete. Fresh gates: typecheck plus full suite (1180 pass, 1 intentional opt-in skip, 0 fail), coverage (96.59% functions / 98.00% lines), self-check (`SELF-CHECK OK`), and `git diff --check` all pass.
- Tracking files and workflow memory remain outside the automatic implementation commit by task instruction.
