# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Pure domain core: `src/core/types.ts` (all domain types) + `src/core/sessionReducer.ts` (deterministic reducer over `DomainSessionEvent`). No ACP import in src/core (ADR-003).

## Important Decisions
- DomainSessionEvent `tool_call` carries a partial `ToolCallUpdate` (toolCallId required, other fields optional, `diff` nullable) rather than the techspec's literal `call: ToolCallRecord`. Reason: the task's upsert semantics (omitted fields preserved, explicit null clears) are impossible to express with a fully-populated record. Both ACP `tool_call` and `tool_call_update` map to this one domain event (task_03 confirms). Refinement of the techspec, not a contradiction.
- Added `plan: PlanEntry[]` to SessionState so the `plan` DomainSessionEvent has a home and the reducer stays total over the union (techspec shows the plan event but omits a plan field on SessionState).
- `referencedFiles` derivation: edit-kind → "edited" (precedence/sticky), every other kind → "read" (Map value type only allows the two).
- `pendingDiffs`: edit-kind tool call with a `diff` and status `pending`|`in_progress` (completed = applied, failed = terminal, neither pending). PendingDiff = { toolCallId, path, unified }.
- referencedFiles + pendingDiffs are recomputed by folding tool-call turns each reduce (deterministic, order-independent for edited precedence).

## Learnings
- Repo code style: no semicolons, double quotes, 2-space indent, JSDoc block comments. Tests: `import { describe, expect, it } from "bun:test"`. Coverage gate `coverageThreshold = 0.8` in bunfig, run via `bun test --coverage`.

## Files / Surfaces
- src/core/types.ts (new), src/core/sessionReducer.ts (new), src/core/sessionReducer.test.ts (new). Removed src/core/.gitkeep.

## Errors / Corrections

## Ready for Next Run
- task_03 consumes these `DomainSessionEvent`s from the adapter; the reducer is the single writer of SessionState.
