# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Complete the menu-local navigation keymap contract and extend the persistent one-line status hint to advertise `^T hand-off` and `/ menu`.

## Important Decisions

- Treat the task file's explicit item terminology as authoritative: menu movement commands are `prev-item` and `next-item`; Tab remains a navigation key for the next item rather than a global printable binding.
- Preserve the existing `/help` affordance when extending `KEYMAP_HINT`.
- Restore the Ctrl+T global control binding before rendering `^T hand-off`; advertising a retired chord would make the footer misleading. The `/` trigger remains editor-local and is not added to `COCKPIT_KEYMAP`.

## Learnings

- The current committed tree already contains `MenuCommand`, `MENU_KEYMAP`, `matchMenuCommand`, and baseline unit tests from an earlier bundled change; the missing task contract is the footer hint, while the existing movement names use `option` rather than the task's `item` wording.
- Fresh self-check showed `StatusStrip` currently renders `tabNavigationHint`, not `KEYMAP_HINT`; the packet's claim that the extended constant would flow through unchanged is stale against the live runtime seam.

## Files / Surfaces

- Implemented: `src/ui/keymap.ts`, `src/ui/PromptEditor.tsx`, and `src/ui/StatusStrip.tsx`.
- Verified by: `src/ui/keymap.test.ts`, `src/ui/StatusStrip.test.tsx`, `src/ui/CockpitApp.test.tsx`, `src/ui/ConversationView.test.tsx`, and `test/index.integration.test.tsx`.

## Errors / Corrections

- The first full gate after wiring `KEYMAP_HINT` exposed six stale footer assertions that still expected the retired sessions/reload copy. The runtime contract was correct, so those assertions were updated to the new persistent hint and the affected suites passed on rerun.
- Final fresh evidence: `rtk bun run typecheck && rtk bun test` exited 0 with 1,291 passing tests, one intentional ACP skip, and zero failures. Focused keymap coverage reported 100% functions and lines; `rtk bun run selfcheck` rendered `^T hand-off  / menu  /help` and reported `SELF-CHECK OK`.

## Ready for Next Run

- Task 04 is implemented and verified. Task 07 can consume `matchMenuCommand` with the `prev-item` and `next-item` command names while keeping the `/` trigger editor-local.
