# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Add `setSessionConfigOption(configId, value, sessionId?)` controller action (mirrors `sendPrompt`/`cancel`) and seed session-start config options into the store on `startSession`.

## Important Decisions
- Seeding uses capture-and-replay: the adapter emits `config_options` synchronously *inside* `newSession`, but the controller binds its permanent `onUpdate` only after `store.startSession` (which resets the slice). So a temporary `onUpdate` around `newSession` captures the seed event, and it is re-applied via `store.applyEvent` after the reset. Not changing the adapter's `newSession` signature (that is task_03 scope).
- Action returns `Promise<void>`; store is updated ONLY from the adapter-reported option set via `applyEvent({kind:"config_options"})` - no optimistic state (ADR-004). Errors route through `onError`, leaving confirmed state intact.

## Learnings
- Controller `startSession` ordering is load-bearing: `newSession` (needs acpSessionId) -> `store.startSession` (resets transcript+config) -> subscribe. Seeding must slot between the reset and the permanent subscribe.

## Files / Surfaces
- `src/app/actions.ts` (interface + impl), `src/app/controller.ts` (`startSession` seeding), `src/app/controller.test.ts` (tests), stub `createStubConnection` (extend for config capture/return + newSession seed emit).

## Errors / Corrections
- None. Typecheck clean, 627 tests pass, selfcheck OK.

## Ready for Next Run
- Action shape delivered: `actions.setSessionConfigOption(configId, value, sessionId?)` -> `Promise<void>`. task_06 (ModelSelect UI) and task_08 (hand-off) call this exact surface. The fake controller (`test/fakeController.ts`) records calls in `calls.setSessionConfigOption`.
- Store selector `selectAgentModel`/`selectAgentEffort` (task_04) already reflect both the seeded and post-switch confirmed values - no extra wiring needed by the UI beyond reading them.
