# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Build the Agent Adapter Layer under `src/agent`: `AgentConnection` (spawn + ACP `ClientSideConnection`), pure `SessionUpdate`→`DomainSessionEvent` translation, per-frame coalescing of agent-message deltas, permission routing. Ship in-process mock ACP agent + tests (>=80% cov).

## Important Decisions
- Status events (idle/working/awaiting_approval) are emitted by `agentConnection.ts` lifecycle (prompt start=working, resolve=idle; requestPermission=awaiting_approval then working), NOT by the pure translator. Translator only maps SessionUpdate content variants.
- Coalescing: buffer contiguous `agent_message_chunk` per messageId; flush on frame tick OR synchronously before any non-message event / status to preserve transcript order. Injectable `FrameScheduler` (default ~16ms timer; manual scheduler in tests).
- ACP diff (Diff{path,oldText?,newText}) → domain `unified` via a small LCS line-diff helper in acpTranslate. `content` present w/o diff block => domain `diff: null` (clear); `content` absent => omit (preserve). ACP `switch_mode` kind => domain `other`.
- Transport injectable via factory (default `spawnAgentTransport` = Bun.spawn+ndJsonStream). Tests inject `createInMemoryTransportPair()` (two ndjson byte pipes) so no subprocess in CI.
- Agent-layer public types (ReadyState, PromptBlock, PromptResult, PermissionRequest/Outcome) live in agentConnection.ts; no ACP type leaks past src/agent.

## Learnings
- ACP SDK root (`@agentclientprotocol/sdk`) exports values `ClientSideConnection`, `AgentSideConnection`, `ndJsonStream`, `PROTOCOL_VERSION` (=1); `Stream` + all schema types are type-only. verbatimModuleSyntax => split `import type`.
- `ClientSideConnection(toClient, stream)`; client impl must supply `requestPermission` + `sessionUpdate` (+ optional fs/terminal). Mock uses `AgentSideConnection(toAgent, stream)` with `conn.sessionUpdate()` / `conn.requestPermission()`.

## Files / Surfaces
- new: src/agent/{transport.ts, acpTranslate.ts, agentConnection.ts}, test/mockAgent.ts, src/agent/{acpTranslate.test.ts, agentConnection.test.ts}

## Errors / Corrections
- `bun build --compile`/`bun build --target=bun` FAILS at baseline (pre-task_03): @opentui/core can't resolve platform binaries (`@opentui/core-darwin-x64` etc.). Not a task_03 regression; packaging is task_12. Task gates here are `bun run typecheck` + `bun test` only.
- Async arrow returning a string literal widens to `string`; annotate mock `onPrompt` returns with `as const` (or a StopReason cast) to satisfy `MockPromptScript`.

## Ready for Next Run
- Agent Adapter Layer done & verified: 58/58 tests pass, tsc clean, src/agent coverage ~97.7% lines (acpTranslate 100%). ACP SDK confined to src/agent (+ test/mockAgent.ts).
- Public agent-layer API for downstream tasks (import from `src/agent/agentConnection.ts`): `createAgentConnection({config, transport?, scheduler?})`, `AgentConnection`, `ReadyState`, `PromptBlock`, `PromptResult`, `PermissionRequest`/`PermissionOptionView`/`PermissionOutcome`, `FrameScheduler`/`createFrameScheduler`. Transport seam: `spawnAgentTransport` (default) + `createInMemoryTransportPair()` (tests) in `src/agent/transport.ts`. Mock: `startMockAgent(stream, {sessionId?, onPrompt?})` in `test/mockAgent.ts`.
- task_05 (store): consume `onUpdate` DomainSessionEvent stream (already coalesced) + apply via `sessionReducer`. task_04 (readiness): call `connect()` → `ReadyState`. task_07 (controller): create/orchestrate connections, register `onPermission`.
