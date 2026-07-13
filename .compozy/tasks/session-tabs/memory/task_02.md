# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Integrate the task_01 workspace reducer into AppStore so workspace metadata is the sole selection/lifecycle authority, with nullable empty-workspace focus and narrow tab/attention selectors.

## Important Decisions

- Keep `SessionState` normalized and reducer-owned; AppStore lifecycle methods compose workspace events with execution-slice insertion/removal in one commit.
- Remove independent `focusedSessionId` state. Agent pane identity follows `workspace.selectedVisibleId`; shell focus preserves selection; empty selection uses the workspace pane.
- Preserve unrelated tab item identities with selector-level memoization keyed by workspace-conversation identity plus the few execution primitives rendered by that item.
- Add a single captured-target tab-dialog overlay slot now so approval precedence and target identity are store-testable before later UI tasks.

## Learnings

- The pre-change store/selector baseline is green (82 focused tests plus typecheck), but `AppState` still owns `focusedSessionId` and has no workspace slice or lifecycle actions.
- Existing task_01 tracking changes and its untracked memory artifact predate this task and must remain untouched.
- `applyEvent` can preserve streaming isolation by invoking the workspace reducer only when the reduced execution status changes; transcript deltas retain the exact workspace reference.
- Workspace item memoization must include rendered execution primitives (status/provider/cwd) while keying durable metadata by `WorkspaceConversation` identity; this keeps sibling tab objects stable when one session streams or changes status.

## Files / Surfaces

- Core implementation and tests: `src/store/appStore.ts`, `src/store/appStore.test.ts`, `src/store/selectors.ts`, `src/store/selectors.test.ts`.
- Nullable selection compatibility: `src/app/actions.ts`, `src/app/controller.ts`, `src/app/handoff.ts`, `src/persistence/runWriter.ts`, `src/telemetry/recorder.ts`, `src/ui/CockpitApp.tsx`, `src/ui/ConversationView.tsx`, `src/ui/PromptEditor.tsx`, `src/ui/StatusStrip.tsx`, their affected tests, and shared fake-controller fixtures.

## Errors / Corrections

- The first combined PRD/ADR read was truncated; reread the TechSpec and ADRs in bounded chunks before implementation.
- Removing `focusedSessionId` exposed nullable consumer assumptions across actions, handoff, UI, telemetry, and V1 writer code; added explicit no-selection guards and stable empty selector values rather than fabricating an ID.

## Ready for Next Run

- Task implementation is verified: 1,132 tests pass (one opt-in ACP probe skipped), coverage is 98.01% lines / 96.53% functions, typecheck passes, self-check prints `SELF-CHECK OK`, and the host build succeeds.
- V2 persistence of a truly empty workspace remains owned by task_03; the legacy V1 writer reports its existing fail-soft persistence error when selection is null instead of inventing a focused session.
