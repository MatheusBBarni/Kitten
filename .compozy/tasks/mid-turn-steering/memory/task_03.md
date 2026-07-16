# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Enforce one active ACP prompt at the adapter boundary and add a protocol-free, fail-closed native-steering capability resolved from the final merged recipe.

## Important Decisions

- Keep V1 native steering unavailable: production certification and adapter-implementation registries remain empty.
- Require two independent inputs before classification can return `native`: an exact certified recipe and a matching adapter-local terminal-acknowledgement implementation identity.
- Reject concurrent prompt entry without emitting status or touching the existing in-flight prompt record.

## Learnings

- `AgentConnectionImpl.beginPrompt()` currently calls `completePrompt(this.inFlightPrompt)`, which clears and replaces active tracking before the next ACP dispatch.
- Clarification capability already provides the repository pattern for exact command, ordered-argument, full-environment, package, and version matching.
- The in-memory ACP transport can defer the first prompt deterministically; after the guard rejects a second call, the mock sees one request and the first call still settles to `end_turn` / `finished`.
- Focused coverage reports 100% lines/functions for `steeringCapability.ts` and 97.6% lines / 94.2% functions for `agentConnection.ts`.

## Files / Surfaces

- Capability and resolution: `src/core/types.ts`, `src/config/steeringCapability.ts`, `src/config/configLoader.ts`, `src/agent/nativeSteering.ts` and their tests.
- Adapter guard: `src/agent/agentConnection.ts` and `src/agent/agentConnection.test.ts`.
- Required resolved-config fixture updates: clarification, explore, readiness, persistence, and adapter integration/contract tests.

## Errors / Corrections

- The worktree contains unrelated user changes, including controller and telemetry work; preserve them and stage only task-owned files.
- Making `steeringCapability` required exposed every manually constructed `ResolvedAgentConfig`; all affected fixtures now explicitly carry `{ status: "unavailable" }`.

## Ready for Next Run

- Implementation, task-specific tests, focused coverage, full typecheck/test gate, and self-review are complete.
- V1 production recipe certification and adapter-local implementation registries are both empty; later native support must add both deliberately.
