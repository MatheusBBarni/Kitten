# Task Memory: task_10.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add only the approved content-free projection and history-reveal telemetry after the real enabled projection/reveal seam exists.

## Important Decisions

- No source edit was started because Task 08's required projection/reveal seam is absent and the resolved experiment flag has no production path into `CockpitApp` or `ConversationView`.

## Learnings

- `task_08.md` is marked `completed`, but `ConversationView` still subscribes to `selectSessionTurns`, renders raw turns by array index-derived keys, and has no history marker, reveal activation, or anchor behavior.
- Task 08's own memory records the same flag-delivery blocker and says no source edit was started.
- `transcriptWindowingEnabled` is resolved in boot config, but `CockpitSession`, `SessionController`, `cockpitElement`, `CockpitApp`, and cockpit context do not carry it to the default conversation path.

## Files / Surfaces

- Read-only inspection: recorder, cockpit, conversation view/tests, projection selectors/core, boot/render seams, PRD/TechSpec/ADRs, Task 08 tracking and memory.
- Updated this task memory and shared workflow memory only.

## Errors / Corrections

- Blocking source-of-truth mismatch: Task 10 requires emissions at the Task 08 seam and default-path recorder threading, but that seam does not exist. Satisfying the task would require absorbing Task 08 and changing boot/render flag delivery outside Task 10's named surfaces.

## Ready for Next Run

- Resume after the task packet authorizes a concrete resolved-flag delivery path and Task 08 is implemented (or Task 10 is explicitly expanded to repair Task 08 and the boot/render contract).
