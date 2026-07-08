# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- DONE. `src/app/{controller,actions}.ts` + `src/app/controller.test.ts`. 209/209 tests pass, tsc clean, coverage exit 0 (actions 100%, controller 96.3% funcs / 99.0% lines).

## Important Decisions
- `sendPrompt` records the user turn itself (`applyEvent` with a `user_message` event) because ACP never echoes the prompt back - without this the transcript would never show what the developer typed.
- Actions never reject: a connection failure is reported through the injectable `onError(agentId, error)` and the call returns `null`/void. A keypress handler must not throw into the React tree.
- Permission requests are a FIFO queue in the controller, not a single slot: the store has one approval slot, so a second concurrent request (other agent, or the same one twice) waits behind the one on screen. `dispose()` resolves every queued request as `cancelled` so no agent is left blocked.
- `startSession` is called before `onUpdate` is subscribed, since `startSession` resets the slice and would discard an event that arrived first.
- The controller only overrides the store's focus when the focused agent failed to come up (then it focuses the first ready agent). If neither is ready, focus is untouched so the status strip still names an agent.
- A connection that fails `connect()`/`newSession()` is disposed immediately and its runtime keeps `connection: null`, so `getSession` returns undefined and the action surface is inert for that agent.

## Learnings
- Bun's per-file coverage counts *functions*, so an unused default seam (`?? (() => {})`) shows up as an uncovered function. Direct `createControllerActions` tests exercising the defaults keep actions.ts at 100%.
- The controller imports `createAgentConnection` as a value (it is the composition root), which is fine: ADR-003 only forbids importing the ACP SDK above `src/agent`. Boundary check is `grep -rn agentclientprotocol/sdk src | grep -v ^src/agent/`.
- Integration tests inject an immediate `FrameScheduler` (`{schedule: f => f(), dispose(){}}`) into `createAgentConnection` so streamed deltas land deterministically without waiting on the 16ms coalescing timer.

## Files / Surfaces
- `src/app/controller.ts` (new), `src/app/actions.ts` (new), `src/app/controller.test.ts` (new). No existing file changed.

## Errors / Corrections
- None substantive; one TS strictness fix in the test (indexing a tuple after a `.kind` narrowing needs a mapped array, not `turns[0]!.kind === "user" && turns[0].messageId`).

## Ready for Next Run
- UI tasks consume `createSessionController(...)` → `{ store, actions, runtimes(), runtime(id), isReady(id), dispose() }`. See the shared MEMORY.md "Public APIs" entry.
- Nothing mounts the controller yet: `src/app/bootstrap.tsx` still renders the task_01 placeholder `CockpitApp`. task_08 owns booting the controller and passing `store`/`actions` into the React tree (note the task files name `src/ui/CockpitApp.tsx`, while the scaffold placeholder lives at `src/app/CockpitApp.tsx`).
