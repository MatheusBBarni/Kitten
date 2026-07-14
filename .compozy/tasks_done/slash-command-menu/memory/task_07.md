# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Complete the existing PromptEditor slash-menu integration against task_07's trigger, ordering, invocation, non-modal, and transcript-isolation contracts, with the full required test matrix.

## Important Decisions

- Preserve the live repo's `COCKPIT_COMMANDS` registry as the source of slash-command metadata while sourcing shortcut labels from `COCKPIT_KEYMAP`; explicitly rank `hand-off` first to satisfy the task's cockpit-first teaching contract.
- Keep menu interaction state local to `SelectedPromptEditor`; no store overlay or transcript state is involved.
- Treat a caret positioned before the slash (`cursor === token start`) as outside the completion token; the menu only owns the token once the caret is after its leading slash.

## Learnings

- The committed tree already contains most task_07 behavior from an earlier bundled integration, but the focused PromptEditor suite has only two slash-menu tests and omits the required trigger edges, dismissal fall-through, ordering, cursor, and transcript render-count cases.
- Baseline `slashMenuRows("", ...)` orders cockpit rows as `/shell, /copy, /switch, /handoff, /sessions`, which violates the task's explicit hand-off-on-top acceptance case.
- Baseline `rtk bun test src/ui/PromptEditor.test.tsx` passes 18 tests with 0 failures, so missing coverage and the wrong open-state ranking are the concrete pre-change signals.
- Full-suite coverage passes at 97.15% functions and 98.36% lines; `src/ui/PromptEditor.tsx` is 93.55% functions and 98.76% lines.

## Files / Surfaces

- Implemented: `src/ui/PromptEditor.tsx` and `src/ui/PromptEditor.test.tsx`.
- Tracking/memory: `.compozy/tasks/slash-command-menu/task_07.md` and `.compozy/tasks/slash-command-menu/memory/task_07.md`.

## Errors / Corrections

- The first expanded focused runs exposed that substring filtering made `/rev` match `/previous-tab` (`pREVious`) even after descriptions were excluded; filtering is now a command-name prefix match, so `/rev` uniquely highlights `/review` as the explicit acceptance case requires.
- Immediate frame capture after Escape observed the pre-update paint; the dismissal test now waits for the frame where the menu is absent before asserting fall-through behavior.
- The first transcript Profiler harness left the prompt at the top and clipped the menu; a flex-growing transcript container now mirrors the real cockpit's bottom-docked editor layout.
- Focused coverage reports PromptEditor at 93.55% functions and 98.76% lines, but the command exits nonzero because its transitive-import aggregate is below the repository-wide threshold; use the full-suite coverage run for the enforced aggregate gate.

## Ready for Next Run

- Implementation and self-review are complete. The menu is token-boundary guarded, prefix-filtered, hand-off-first, non-modal, invoke-not-send, and transcript-isolated under navigation.
- Fresh gate: `rtk bun run typecheck && rtk bun test && rtk bun run selfcheck && rtk bun run build` exited 0; 1,299 tests passed, one intentional ACP probe was skipped, self-check printed `SELF-CHECK OK`, and the host build wrote `dist/kitten-darwin-arm64` plus `dist/SHA256SUMS`.
- Local source commit: `cbd208e feat: complete PromptEditor slash menu integration` (not pushed); workflow memory and task tracking remain intentionally uncommitted.
