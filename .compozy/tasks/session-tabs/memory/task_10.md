# Task Memory: task_10.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Guard composer, status, and model controls when `workspace.selectedVisibleId` is null while preserving selected-session behavior.

## Important Decisions

- Split PromptEditor and StatusStrip at the nullable workspace-selection boundary so the no-selection branches cannot construct per-session selectors or consult controller runtime/readiness APIs.
- Guard `AppStore.openModelSelect` to the exact selected Visible SessionId; ModelSelect also hides and clears an overlay if selection later becomes invalid.

## Learnings

- The pre-change focused run failed in all three intended places: `/model` still dispatched from the empty composer, StatusStrip called `controller.runtimes()`, and `openModelSelect` accepted a Background ID while selection was null.
- A model overlay can become stale after opening if lifecycle transitions remove the selected Visible conversation; the mounted component now clears that slot after suppressing the overlay.

## Files / Surfaces

- `src/ui/PromptEditor.tsx` and tests
- `src/ui/StatusStrip.tsx` and tests
- `src/ui/ModelSelect.tsx` and tests
- `src/store/appStore.ts` and store tests
- Mounted empty-workspace/cockpit integration coverage

## Errors / Corrections

- No requirements conflict found across task_10, the PRD, TechSpec Focus Authority section, or ADR-002/ADR-004.
- Test fixture corrections: backgrounding one of two Visible conversations correctly selects the survivor; OpenTUI frame assertions must wait for the rendered condition rather than only store state.

## Ready for Next Run

- Task implementation and self-review are complete. Fresh evidence: coverage 96.92% functions / 98.20% lines with 1,224 passing before the final overlay regression; final self-check printed `SELF-CHECK OK`, typecheck exited 0, and the full suite passed 1,225 tests with 1 opt-in probe skipped.
- No durable cross-task fact required promotion to shared workflow memory.
