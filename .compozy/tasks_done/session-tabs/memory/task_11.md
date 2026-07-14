# Task Memory: task_11.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Upgrade SessionsOverlay into the ordered Visible/Background overflow and attention surface, with narrow-terminal reachability and preserved modal/handoff behavior.

## Important Decisions

- Kept `selectSessionList` as the shared notifier/model/handoff row seam and extended it with duplicate label, lifecycle, selected, and attention-seen metadata.
- Reused SessionPicker's definite-height `scrollbox`, stable descendant IDs, and `scrollChildIntoView` convention; the footer remains outside the scrolling viewport and word-wraps at narrow widths.
- SessionsOverlay dispatches `jumpToNextAttention`, `selectConversation`, or `reopenConversation` through ControllerActions; only overlay close state remains a direct AppStore UI transition.
- SessionCard shows lifecycle/status/selection/attention as text cues and remains shared with HandoffTargetPicker.

## Learnings

- A clipped flex box hid later rows even though keyboard selection advanced; a definite-height scrollbox is required for OpenTUI overflow reachability.
- Narrow footer text wraps, so tests must assert its visible semantic fragments instead of one contiguous frame substring.
- Integration loops must wait for the overlay frame to unmount, not only the synchronous store close, before reopening or React-local selection can survive the cycle.

## Files / Surfaces

- `src/store/selectors.ts`, `src/store/selectors.test.ts`
- `src/ui/SessionsOverlay.tsx`, `src/ui/SessionsOverlay.test.tsx`
- `src/ui/keymap.ts`
- `test/sessionStatus.integration.test.tsx`
- Compatibility verified through `src/ui/HandoffTargetPicker.test.tsx`.

## Errors / Corrections

- Replaced the pre-overflow test assumption that every row is simultaneously painted with viewport navigation and scroll assertions.
- Updated overlay action assertions from the legacy `jumpToNextNeedy` alias to `jumpToNextAttention`.
- Corrected narrow integration waits to observe overlay unmount rather than the shared status-strip attention hint.
- Coverage initially found two old overflow/hint expectations; updated them to assert the new scrollable attention contract, then reran coverage cleanly.

## Ready for Next Run

- Implementation and self-review complete.
- `bun run test:coverage`: 1,231 pass, 0 fail, 1 intentional opt-in skip; 96.95% functions and 98.21% lines.
- Final `bun run typecheck && bun test && bun run selfcheck`: typecheck clean, 1,231 pass, 0 fail, and `SELF-CHECK OK`.
- Task tracking updated and implementation committed locally as `57ba5cf` (`feat: upgrade Sessions overflow and background navigation`). No push performed.
