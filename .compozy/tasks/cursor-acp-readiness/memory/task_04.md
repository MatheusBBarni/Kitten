# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Render Cursor model controls from the upstream bounded recovery projection, preserving distinct unavailable, ready-empty, and ready-configurable states and routing eligible recheck through `ControllerActions` only.

## Important Decisions

- Do not infer Cursor recovery copy or recheck eligibility from generic `ConversationAvailability.retryable`, runtime readiness, config option shape, or `AgentRuntimeState.error`; task 04 remains a presentation-only consumer of the task 07 projection.

## Learnings

- The required task 07 projection is absent: `ConversationAvailability` has only generic `kind`, `reasonCode`, and `retryable` fields, and `src/store/selectors.ts` exposes only the generic `selectConversationAvailability` selector.
- `.compozy/tasks/cursor-acp-readiness/task_07.md` remains pending even though `_tasks.md` declares `task_07 -> task_03 -> task_04`; the current task 03 implementation gates recheck on generic unavailable state and cannot provide the remediable/non-remediable distinction required by task 04.
- The focused baseline test `shows a plain notice when the agent advertises no visible options` passes and confirms the current provider-generic `NO_OPTIONS_NOTICE` behavior.

## Files / Surfaces

- Read-only inspection: `src/core/types.ts`, `src/store/selectors.ts`, `src/ui/ModelSelect.tsx`, `src/ui/ModelSelect.test.tsx`, `src/app/actions.ts`, `src/app/controller.ts`, and `test/fakeController.ts`.
- Updated only this task memory file; no production or test code was changed.

## Errors / Corrections

- Blocked before implementation because the source-of-truth bounded Cursor recovery contract required by requirements 1-4 is missing. Implementing it here would silently absorb task 07 and violate task 04's presentation-only scope.

## Ready for Next Run

- Resume task 04 only after task 07 lands the closed Cursor recovery type, controller mapping, structural-sharing behavior, and safe selector, and task 03 consumes that state for recheck eligibility.
