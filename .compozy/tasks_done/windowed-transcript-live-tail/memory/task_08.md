# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Integrate the focused transcript projection, counted marker, and renderer-owned per-session anchoring into `ConversationView` while preserving disabled and unavailable-restoration behavior.

## Important Decisions

- No source edit was started because the task's two-file scope cannot currently obtain the resolved `transcriptWindowingEnabled` value.

## Learnings

- `selectFocusedTranscriptProjection` requires explicit `{ enabled, tailTurnCount }` options.
- `ConversationView` can access `SessionController` and `AppStore`, but the current `SessionController`, `AppState`, and cockpit context expose no resolved transcript-windowing flag.
- A defaulted `ConversationView` prop would leave the production default path permanently disabled; hard-enabling the selector would violate the strict default-off and disabled-mode contracts.

## Files / Surfaces

- Read-only inspection: `src/ui/ConversationView.tsx`, `src/ui/ConversationView.test.tsx`, `src/store/selectors.ts`, `src/store/appStore.ts`, `src/core/transcriptProjection.ts`, and the OpenTUI ScrollBox contract.
- Updated only this task memory file.

## Errors / Corrections

- Blocking contract mismatch: task 08 restricts implementation to `ConversationView.tsx` and its test, while the PRD/TechSpec require the resolved config flag to gate the production selector and no existing in-scope path supplies that flag.

## Ready for Next Run

- Resume after the source-of-truth packet authorizes a concrete flag-delivery seam (for example controller/context/store exposure plus default-path wiring) or explicitly defines a staged `ConversationView` prop contract and names the later production-wiring task.
