# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the pure V1 capability-composition contract, its single reviewed Kitten MCP fragment, and the assigned core/renderer tests without changing lifecycle, adapter, telemetry, or persistence owners.

## Important Decisions

- Follow the TechSpec vocabulary exactly: `confirmed`, `absent`, and `unknown`; controller-owned stale or conflicting evidence is represented as non-confirmed input and therefore selects base-only output.
- Ignore `generation` and inactive future capability facts during composition so equivalent closed snapshots remain deterministic while lifecycle validation stays outside core.

## Learnings

- The mandated TechSpec fragment ID `capability.kitten-mcp.v1` is rejected by the existing renderer's lowercase dot-separated ID grammar; `harnessPrompt.test.ts` also explicitly rejects a hyphenated segment.

## Files / Surfaces

- Planned task-owned surfaces: `src/core/harnessCapabilityComposition.ts`, `src/core/harnessCapabilityComposition.test.ts`, and `src/core/harnessPrompt.test.ts`.
- The worktree contains unrelated pre-existing changes, including controller and adapter edits; preserve them and stage only task-owned files.

## Errors / Corrections

- Baseline: `src/core/harnessCapabilityComposition.ts` is absent, so the contract and assigned coverage do not yet exist.
- A first implementation using the literal TechSpec ID reached targeted verification, where `renderHarnessPrompt` returned `invalid_block_id` (51 tests passed, 1 failed). The implementation was removed rather than changing either source-of-truth contract implicitly.

## Ready for Next Run

- Blocked on an explicit contract choice: rename the catalog ID to a renderer-valid stable ID (for example `capability.kitten.mcp.v1`) or expand the renderer ID grammar and its existing contract tests.
