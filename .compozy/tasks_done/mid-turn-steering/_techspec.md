# Technical Specification: Mid-Turn Steering

## Executive Summary

Implement Mid-Turn Steering as a protocol-free, reducer-owned lifecycle with a controller-owned effect runner. The core defines one active turn, ordered steering requests, request identity, generation fencing, and terminal recovery. The controller serializes interaction-safe effects; `src/agent/` performs only verified native steering or the standard ACP cancel-and-follow-up fallback. The store remains the only writer of session state.

The primary trade-off is more explicit lifecycle state and race coverage in exchange for a lossless, provider-neutral experience. V1 deliberately prefers safe recovery over a faster but ambiguous redirect. The current ACP client surface documents `prompt` and `cancel`; it does not justify assuming a generic native steering operation, so native support is capability-gated and disabled until certified.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary |
| --- | --- | --- |
| `src/core/steering.ts` | Pure steering types, legal transitions, ordered coalescing, and recovery projection | No I/O, no ACP, no React |
| `src/core/types.ts` and `sessionReducer.ts` | Adds steering state and protocol-free steering events to `SessionState` | Reducer remains the sole session-state writer |
| `src/store/appStore.ts` and `selectors.ts` | Applies steering events and exposes narrow state/recovery selectors | No transport decisions |
| `src/app/steeringCoordinator.ts` | Per-session effect runner, safe-boundary checks, timeout ownership, and generation fencing | Owns effects and timers, not lifecycle truth |
| `src/app/actions.ts` and `controller.ts` | Exposes `steer`, rejects ordinary active-turn dispatch, triggers advancement on terminal boundaries | UI reaches agents only through actions |
| `src/agent/agentConnection.ts` | Rejects concurrent prompt entry, executes fallback transport, and hosts a future verified native capability | Only ACP-facing layer |
| `src/ui/PromptEditor.tsx` | Sends steering while work is active, renders compact status, restores one recovery draft | No direct transport or store mutation |

### Data Flow

1. `PromptEditor` detects an active focused session and calls `ControllerActions.steer()` instead of ordinary `sendPrompt()`.
2. The action records a protocol-free enqueue event. The reducer creates the ordered request and publishes the compact `queued` projection.
3. `SteeringCoordinator` reads the current generation and interaction state. It waits while the targeted session has an unresolved permission or clarification.
4. The coordinator dispatches a phase event, then uses a verified native adapter method when available; otherwise it requests cancellation, waits for the active prompt's bounded terminal settlement, and sends one coalesced follow-up.
5. Confirmed delivery emits the one transcript user turn and clears the request. Failure or lifecycle loss emits a recoverable terminal event containing the exact ordered blocks.
6. `PromptEditor` copies the one-time recovery blocks into its textarea, acknowledges recovery, and the reducer clears the raw queue.

### PRD Traceability

| PRD Requirement | Technical Component |
| --- | --- |
| One active task per session | Adapter concurrent-prompt guard plus core active-turn identity |
| Ordered steering and safe delivery | Core queue transitions plus controller effect runner |
| Lossless recovery | Reducer recovery event, action result, and PromptEditor acknowledgement |
| Composer-first status | Steering selector and PromptEditor status row |
| Consistent supported-agent experience | Verified capability seam and universal fallback |

## Implementation Design

### Core Interfaces

Use TypeScript interfaces to match the Kitten codebase and preserve existing strict type boundaries.

```ts
export type SteeringPhase = "idle" | "queued" | "waiting" | "cancelling" | "settling" | "sending" | "failed"

export interface SteeringRequest {
  readonly id: string
  readonly generation: number
  readonly blocks: readonly PromptBlock[]
  readonly phase: SteeringPhase
}

export interface SteeringState {
  readonly activeTurnId: string | null
  readonly queue: readonly SteeringRequest[]
  readonly recovery: readonly PromptBlock[] | null
}
```

`src/core/steering.ts` exports pure transition functions for enqueue, start, wait, send, deliver, recover, and acknowledge-recovery. Each transition requires the current request id and generation where it can settle an asynchronous effect. Invalid, stale, or duplicate settlements return the original state.

`ControllerActions` gains `steer(input, sessionId?)`. `sendPrompt()` fails closed for a working session so background callers cannot create a competing ACP prompt. `steer()` returns a discriminated result for queued, unavailable, or immediately recovered input; UI failures remain fail-soft.

### Data Models

| Model | Owner | Fields | Persistence rule |
| --- | --- | --- | --- |
| `SteeringState` | Core/session reducer | active turn id, ordered requests, phase, one recovery payload | Live only; never added to run-record schemas |
| `SteeringRequest` | Core | UUID, session generation, composed prompt blocks, phase | Cleared on delivery, acknowledgement, or terminal recovery |
| Active turn handle | Controller coordinator | session id, generation, prompt settlement promise, timeout handle | Ephemeral and never projected as source of truth |
| `SteeringCapability` | Config and adapter boundary | `unavailable` or certified `native` identity | No raw provider extension data outside adapter |
| Steering telemetry outcome | Recorder | allowlisted outcome, capability class, duration bucket | Opt-in and content-free; no text, ids, paths, or adapter details |

The store projection exposes only the phase, queue count, and recovery availability to ordinary selectors. Raw blocks are available only to the focused recovery path and are removed immediately after acknowledgement. A delivered coalesced follow-up becomes one normal user turn; the original turn's terminal status establishes the interruption context without duplicating the steering text.

### API Endpoints

No HTTP or external API endpoint is added. The internal action surface is:

| Method | Input | Result | Behavior |
| --- | --- | --- | --- |
| `steer(input, sessionId?)` | non-empty `PromptInput` and optional target | `SteeringResult` | Queues direction for one active session or exposes recovery/unavailability |
| `sendPrompt(input, sessionId?)` | ordinary prompt | existing result or `null` | Refuses active-turn concurrency |
| `cancel(sessionId?)` | optional target | `Promise<void>` | Remains explicit hard stop and terminalizes any in-flight steering safely |
| `acknowledgeSteeringRecovery(sessionId, requestId)` | recovery identity | `void` | Clears the one-time raw recovery payload after editor copy |

## Integration Points

| Boundary | Integration | Error Handling |
| --- | --- | --- |
| ACP TypeScript SDK | Standard `prompt` and `cancel` through `AgentConnection` | Treat a missing or late terminal response as bounded, recoverable failure |
| Verified native provider behavior | Optional adapter-only native steering capability | Fail closed unless both configuration and adapter implementation are certified |
| Existing interaction coordinator | Query targeted pending interaction state before cancellation and trigger advancement after terminal resolution | Keep permission and clarification ownership unchanged; never cancel or resolve them on behalf of steering |
| Run persistence and telemetry | Content-free checkpoint and recorder boundaries | Exclude queued blocks, recovery text, request ids, and raw errors |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| `src/core/types.ts` | Modified | Adds steering types and domain events; medium semantic risk | Define closed unions and documentation |
| `src/core/steering.ts` | New | Pure lifecycle transition module; low integration risk | Add exhaustive state-transition tests |
| `src/core/sessionReducer.ts` | Modified | Folds steering events into session state; medium regression risk | Preserve structural sharing and existing turn derivations |
| `src/store/appStore.ts` and `selectors.ts` | Modified | Publishes narrow steering projection and recovery acknowledgement | Add selector stability tests |
| `src/app/steeringCoordinator.ts` | New | Runs cancellation, settlement wait, and follow-up sequence; high race risk | Fence every effect by request id and generation |
| `src/app/actions.ts` and `controller.ts` | Modified | Adds steering action and lifecycle hooks | Keep all callbacks fail-soft and target-captured |
| `src/agent/agentConnection.ts` | Modified | Rejects concurrent prompt entry and hosts optional native path | Do not leak ACP types above adapter |
| `src/ui/PromptEditor.tsx` | Modified | Routes active submission to steer and restores draft | Preserve textarea, file-reference, history, and modal behavior |
| `src/persistence/*` and telemetry | Modified or test-only | Proves no queued content is checkpointed or emitted | Add negative serialization assertions |

## Testing Approach

### Unit Tests

- Add `src/core/steering.test.ts` for every legal transition, duplicate settlement, stale request id, stale generation, ordered coalescing, recovery acknowledgement, and raw-block clearing.
- Extend `sessionReducer.test.ts` for structural sharing, transcript ordering, and no duplicate steering user turn.
- Add `src/app/steeringCoordinator.test.ts` with deferred prompt/cancel promises for waiting, bounded timeout, late success, cancellation failure, follow-up failure, and idempotent cleanup.
- Extend `agentConnection.test.ts` to prove a second `prompt()` is rejected without clearing the original in-flight record.
- Add selector and persistence tests proving queue text, recovery text, ids, and raw errors never serialize or enter telemetry.

### Integration Tests

- Extend `controller.test.ts` with real store plus injected connections to cover one active prompt, many ordered steering submissions, safe interaction drain, close, provider crash, and generation replacement.
- Add rendered `PromptEditor` tests for queued, sending, and failed status; restored exact textarea content; keyboard routing; history; file-reference preservation; and no color-only status meaning.
- Add a real adapter/controller/UI integration using the existing in-memory transport and scripted permission or clarification requests to prove they remain attributed to the interrupted turn.

## Development Sequencing

### Build Order

1. Add `SteeringState`, events, pure transitions, reducer wiring, and exhaustive core tests — no dependencies.
2. Add narrow selectors and store acknowledgement plumbing — depends on step 1.
3. Add the controller effect runner and targeted interaction-boundary query — depends on steps 1 and 2.
4. Add the adapter concurrent-prompt guard and fail-closed capability seam — depends on step 1.
5. Wire `ControllerActions`, controller lifecycle hooks, and hard-stop terminalization — depends on steps 2, 3, and 4.
6. Update `PromptEditor` for active steering state and one-time recovery draft restoration — depends on steps 2 and 5.
7. Add controller, adapter, persistence, telemetry, and rendered UI integration coverage — depends on steps 1 through 6.

### Technical Dependencies

- No external service or database dependency is required.
- Native steering remains unavailable until an adapter-specific capability and terminal acknowledgement contract are certified.
- The bounded settlement duration must be defined as a named controller constant and made injectable for deterministic tests.
- Existing persistence schemas remain content-free; no version bump is needed unless a future product decision persists steering metadata.

## Monitoring and Observability

- When opt-in telemetry is enabled, record only allowlisted steering lifecycle outcomes: queued, delivered, recovered, timeout, and unavailable; include a coarse duration bucket and capability class.
- Do not record prompt blocks, recovery text, request ids, ACP session ids, paths, raw provider errors, or adapter configuration.
- Treat a recovered outcome as a developer-visible failure signal, not a hidden automatic retry. No remote alerting is introduced in V1.
- During dogfood, review aggregate content-free outcome ratios against the PRD targets and investigate any recovery or timeout cluster through reproducible local traces, never prompt content.

## Technical Considerations

### Key Decisions

- **Reducer-owned steering state:** keeps lifecycle validity deterministic and prevents controller/UI split-brain.
- **Controller effect runner:** sequences asynchronous transport without putting promises, timers, or ACP types in core state.
- **Adapter concurrent-prompt guard:** preserves the invariant even if a caller bypasses the intended action path.
- **Fail-closed native capability:** current ACP `prompt` and `cancel` semantics remain the V1 baseline; no generic native steering method is assumed.
- **Non-persistent recovery:** exact unsent text returns to the live composer once, rather than replaying after restoration.

### Known Risks

- **Late terminal response after timeout:** high impact, medium likelihood. Bind every settlement to request id and generation; a late result becomes a no-op after recovery.
- **Interaction appears while fallback starts:** medium impact, medium likelihood. Recheck the targeted interaction boundary immediately before cancellation and advance again on interaction settlement.
- **UI draft overwrite:** high impact, low likelihood. Restore only an acknowledged recovery payload and do not overwrite non-empty editor text; surface a recovery notice instead when a draft changed.
- **Native capability drift:** medium impact, low likelihood. Default unavailable and certify exact adapter identity before enabling.
- **Scope expansion:** medium impact, medium likelihood. Keep V1 to a single queue, compact composer status, and no automatic replay, timeline, or provider policy UI.

## Architecture Decision Records

- [ADR-001: Adopt a Lossless, Provider-Neutral Steering Contract for V1](adrs/adr-001.md) — Defines the product-level safe steering contract.
- [ADR-002: Make V1 Steering Lossless and Composer-First](adrs/adr-002.md) — Chooses restored text and compact composer status.
- [ADR-003: Model Steering as a Protocol-Free State Machine with a Controller Effect Runner](adrs/adr-003.md) — Separates reducer truth from asynchronous effect execution.
- [ADR-004: Fail Closed on Native Steering and Recover Unsent Text on Lifecycle Loss](adrs/adr-004.md) — Gates native behavior and forbids queued-text persistence.
