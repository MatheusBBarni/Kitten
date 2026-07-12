# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Store surface for the selector: `modelSelect` overlay slot, curried config selectors, and the fail-closed `visibleConfigOptions` allowlist. Done.

## Important Decisions

- `visibleConfigOptions` + `VISIBLE_CATEGORIES` + `MODEL_CATEGORY`/`EFFORT_CATEGORY` constants live in `src/core/types.ts` (pure, techspec "Domain Core"), not selectors.ts, so both selectors and UI reuse them without importing the store.
- `ModelSelectOverlay = { sessionId }`; `openModelSelect(overlay)` mirrors `openApproval`/`openHandoffTarget` (object payload), NOT the raw-id form the techspec data-flow shorthand shows. Codebase uses `sessionId`, not `agentId` (task file naming predates the AgentId->SessionId rename).
- `selectAgentConfigOptions` returns the RAW `configOptions` slice (referentially stable). `visibleConfigOptions` is applied+memoized by the UI, never inside the selector (a filter inside would mint a new array each call and thrash subscribers).
- `selectAgentModel`/`selectAgentEffort` return `string | undefined` (primitive, value-compared) via `find(category === ...)?.currentValue`.

## Learnings

- Task file referenced `selectAgentStatus` and lines that don't exist; real selector is `selectSessionStatus`. Used the exact names the task requires (`selectAgentConfigOptions/Model/Effort`) since dependent tasks 06/07 reference them.
- `src/store/appStore.test.ts` line ~71 asserts the exact `overlays` shape with `toEqual` - adding a slot required updating that assertion.

## Files / Surfaces

- `src/core/types.ts` (+ `types.test.ts` new): allowlist constants + `visibleConfigOptions`.
- `src/store/appStore.ts`: `ModelSelectOverlay`, `modelSelect` slot, `openModelSelect`/`closeModelSelect`, init null.
- `src/store/selectors.ts`: `selectAgentConfigOptions/Model/Effort`, `selectModelSelectOverlay`, OR into `selectHasOpenOverlay`.
- Tests: `appStore.test.ts`, `selectors.test.ts`, `types.test.ts`.

## Errors / Corrections

None.

## Ready for Next Run

- task_05 (controller action) can call `store.openModelSelect({ sessionId })` and seed via `applyEvent`.
- task_06 UI reads `selectModelSelectOverlay` (open slot) + `selectAgentConfigOptions` then applies `visibleConfigOptions`.
- task_07 StatusStrip reads `selectAgentModel`/`selectAgentEffort`.
</content>
</invoke>
