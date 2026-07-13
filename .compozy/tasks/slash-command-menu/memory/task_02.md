# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Complete the ACP `available_commands_update` adapter translation and its required coverage without regressing newer adapter behavior already present in `HEAD`.

## Important Decisions

- Preserve `usage_update -> { kind: "usage" }`: task_02's older null-variant wording predates commit `0d141d2`, which intentionally surfaced content-free usage counters.
- Use the task/ADR name `translateCommand` and map `hint` directly from `command.input?.hint`, while copying no ACP extension fields.

## Learnings

- Commit `81d6fbc` already landed most of task_02 alongside broader ACP/Codex fixes, but task tracking remained pending.
- The existing completeness test did not feed an available-commands event through its forbidden-key walk, and no empty-list translation test existed.
- Full coverage finished at 97.04% functions / 98.26% lines overall; the adapter translator reached 100% for both.

## Files / Surfaces

- `src/agent/acpTranslate.ts`
- `src/agent/acpTranslate.test.ts`

## Errors / Corrections

- Corrected the stale task assertion that `usage_update` is unsurfaced after reconciling it with current repository behavior.

## Ready for Next Run

- Task implementation, coverage, self-review, and the fresh pre-commit gate are complete.
- Local implementation commit: `82923bc` (`feat: complete ACP available commands translation`); tracking and workflow-memory files remain uncommitted by policy.
