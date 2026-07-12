# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add bash/zsh shell integration plus xterm OSC 133/7 parsing so runtime events carry trustworthy command text, output, exit code, and cwd while unsupported shells degrade to raw rendering.

## Important Decisions

- Treat ADR-005 and `_techspec.md` as superseding the PRD's older full-window takeover wording; the discrepancy does not affect this task's OSC integration boundary.
- Capture unredacted semantic output from xterm's rendered buffer at OSC 133 `D`, rather than raw PTY control bytes; this excludes zsh prompt-cleanup artifacts while preserving what the user saw.

## Learnings

- Pre-change probe: a `133;B` / `133;D;0` byte stream through the task 03 in-memory runtime emitted no semantic events (`[]`), while the existing focused runtime suites passed 8/8.
- Zsh emits prompt end-of-line cleanup bytes between `preexec` and `precmd`; raw byte slicing included `%` plus padding in command output, while the xterm buffer boundary produced the correct semantic output.
- A shell-integration flag inherited by the Kitten process belongs to the parent PTY and must be cleared for the newly spawned PTY; nested shells then inherit the child hook's flag and correctly avoid duplicate markers.

## Files / Surfaces

- `src/shell/shellIntegration.ts`, `src/shell/assets/*`, `src/shell/shellRuntime.ts`
- `src/core/types.ts`, `src/core/shellReducer.ts`
- `src/shell/shellRuntime.test.ts`, `src/core/shellReducer.test.ts`, `test/shellRuntime.integration.test.ts`

## Errors / Corrections

- Added asset module declarations after TypeScript rejected `.bash`/`.zsh` text imports.
- Replaced an intermediate raw PTY byte capture with xterm buffer extraction after the real zsh test exposed prompt-cleanup contamination.
- The first final-gate run hit a Bun 1.3.13 native OpenTUI/TreeSitter teardown segfault; an unchanged rerun completed 844/844, matching the preceding successful full coverage run.

## Ready for Next Run

- Task 04 implementation and self-review are complete. Focused verification passed 26/26; full coverage passed 844/844 at 98.50% lines; task surfaces are 95.89%+ lines; the fresh full gate passed 844/844 after typecheck. Compiled asset embedding also passed.
- Task 05 can consume `ShellRuntime.onEvent`; `command_finished` now carries `output`, and snapshots contain closed command records with semantic xterm-rendered output.
- Scoped local code commit: `80d903b` (`feat: add OSC shell integration events`); workflow tracking and memory files remain outside the commit.
