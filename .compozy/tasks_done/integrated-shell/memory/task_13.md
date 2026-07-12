# Task Memory: task_13.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add an optional Shell context section to the existing hand-off preview, curate commands by id with the existing navigation/Space gesture, and record snapshot attachment only when a confirmed hand-off carries at least one command.

## Important Decisions

- Keep the preview navigation order as referenced files, pending diffs, then shell commands; cwd is visible context but is not independently droppable.
- Reuse the existing immutable set toggle helper so command exclusions are identity-based and cannot drift when row indices change.
- Record `shell_snapshot_attached` in `HandoffFlow.confirm` from `includedCommands`, after the non-empty compose gate and alongside the existing content-free hand-off telemetry.
- Extend the canonical UI, hand-off flow, and shell hand-off integration suites rather than creating new test files.

## Learnings

- Tasks 11 and 12 are implemented in the working tree even though their tracking files remain pending: the recorder method, bundle shell field, exclusion helper, and shell prompt composition are available.
- The workflow shared memory already records a warning-emitting full-suite baseline that blocks `cy-final-verify` completion and automatic commits until the gate is warning-clean.
- The existing global redaction notice already surfaces shell-output redactions because task 12 folds them into `bundle.redactionCount`; the shell section does not need a second counter.
- Keeping only the highlighted command output visible mirrors selected-diff rendering and keeps cwd plus every command row navigable in a bounded terminal dialog.

## Files / Surfaces

- `src/ui/HandoffPreview.tsx`: optional Shell context section, cwd, command/status rows, highlighted output, navigation offsets, and immutable `excludedCommands` state.
- `src/app/handoff.ts`: content-free `shellSnapshotAttached()` emission when `includedCommands` is non-empty after curation.
- `src/ui/HandoffPreview.test.tsx`: present/absent rendering and file/diff-to-command navigation/drop coverage.
- `src/app/handoff.test.ts`: surviving-command and all-dropped telemetry branches.
- `test/handoffShell.integration.test.ts`: mounted cockpit flow that navigates from a file into shell context, drops one command, confirms, and asserts the sent prompt.

## Errors / Corrections

- Pre-change gap: `HandoffPreview` counts only file/diff rows, always sends an empty `excludedCommands` set, and renders no shell section; `HandoffFlow.confirm` does not emit `shell_snapshot_attached`.
- Red baseline: targeted tests failed on the absent shell heading/rows and missing telemetry event; after implementation, 75 targeted tests passed.
- Verification remains warning-blocked despite green exit codes: OpenTUI `theme_mode` listener-limit and TreeSitter-destroyed warnings occur in focused/full tests, and the self-check emits the existing React `act(...)` warning.

## Ready for Next Run

- Implementation and required unit/integration behavior are in place. Re-run the final gate after the repository-wide warning baseline is fixed; do not mark task complete or auto-commit until it is warning-clean.
