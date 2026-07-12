# Task Memory: task_12.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add a redacted, env-free shell snapshot to deterministic hand-off assembly and compose only developer-retained commands into a `Shell context` prompt block.

## Important Decisions

- The assembler accepts the pure shell snapshot as an optional third input and explicitly rebuilds `cwd` plus command records; it never spreads the shell slice, so unrelated fields such as env cannot leak.
- An empty command list produces no `bundle.shell`; excluding every command produces no shell prompt block.
- Multi-session target selection retains the immutable shell-slice reference captured by `begin()`, so later shell events cannot change the snapshot awaiting curation.
- Task 12 adds an empty `excludedCommands` set to the current preview send payload only; per-command preview state and controls remain task 13 scope.

## Learnings

- The current hand-off flow may defer assembly until `chooseTarget()` for multi-session fleets, so satisfying the begin-time snapshot contract requires carrying the captured slice across the picker.

## Files / Surfaces

- `src/core/types.ts`: optional `HandoffBundle.shell`.
- `src/core/bundleAssembler.ts` and test: shell copy/redaction/counting/env exclusion.
- `src/app/handoff.ts` and test: command exclusions, compose block, begin-time snapshot wiring.
- `src/ui/HandoffPreview.tsx`: compile-compatible empty command exclusions pending task 13 UI.
- `test/handoffShell.integration.test.ts`: real assemble-to-compose coverage.

## Errors / Corrections

- Adding required `excludedCommands` initially exposed six stale manual `HandoffEdits` fixtures through typecheck; the fixtures were updated without weakening the required type.
- The exact default `bun test` gate crashed in Bun 1.3.13 with signal 5/segmentation fault during OpenTUI tests. Serialized `bun test --max-concurrency 1` completed 939/939, but still emitted the shared React `act(...)`, listener-limit, and TreeSitter warnings.

## Ready for Next Run

- Implementation evidence is green: focused 73/73, serialized repository 939/939, typecheck exit 0, overall coverage 98.57% lines / 97.25% functions, with `handoff.ts` at 100% and `bundleAssembler.ts` at 97.35% lines.
- Task status/checklists and auto-commit remain untouched because the exact default test command crashed and the serialized gate is not warning-clean.
